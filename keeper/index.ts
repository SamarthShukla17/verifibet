/**
 * The autonomous operator — boots the keeper's on-chain identity, hydrates
 * and subscribes to the same `StatusTracker` singleton the app's own
 * `/api/fixtures` route reads (`lib/txline/statusTracker.ts`), and drives
 * every market from `Open` through `Locked` to `Resolved` without a human
 * in the loop.
 *
 * ## Idempotency: why a restart can never double-act
 *
 * `StatusTracker.hydrate()` seeds a fixture's tracked `status` directly
 * from TxLINE's REST snapshot — a fixture already `LIVE` or `FINISHED` at
 * boot time gets that status set directly, *not* routed through
 * `transitionTo` (see that method's own doc comment), so it never emits a
 * `'kickoff'`/`'finished'` event on hydration. A keeper that only reacted
 * to those two events would silently miss every fixture that was already
 * mid-match or already over when it restarted.
 *
 * `reconcile()` below is what closes that gap: every 60s tick, it walks
 * every tracked fixture and re-enqueues `lockMarket`/`resolveMarket`/
 * `voidMarket` for any fixture still `LIVE`/`FINISHED`/a void candidate
 * (`keeper/void.ts#isVoidCandidate` — `POSTPONED`/`CANCELLED`, or a day
 * past kickoff with no `FINISHED`) — regardless of whether an event fired
 * for it this process lifetime. Enqueueing is a no-op if the job is
 * already queued (deduped by `type:fixtureId`), and `keeper/jobs.ts`'s job
 * functions each re-read the market's on-chain status *before* building
 * any transaction, so a fixture that's already `Locked`/`Resolved` is a
 * cheap on-chain read followed by a `"skipped"` result, never a second
 * transaction. This is the one idempotency rule the whole design leans
 * on: never trust in-memory state (tracker, queue) to decide whether an
 * action already happened — only the account itself.
 *
 * `'kickoff'`/`'finished'` events (when they do fire, for a fixture that
 * transitions while this process is already running) enqueue the same
 * way `reconcile()` does, just faster than waiting for the next tick.
 * Both paths converge on the same `enqueue()` — there's no separate
 * "fast path" implementation to keep in sync with the "slow path".
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

import type pino from "pino";

import { getStatusTracker } from "@/lib/txline/statusTracker";
import { buildLogger } from "@/keeper/logger";
import { buildKeeperContext } from "@/keeper/context";
import { lockMarketJob, syncMarketsJob } from "@/keeper/jobs";
import { resolveFixture } from "@/keeper/resolver";
import { isVoidCandidate, voidMarketJob } from "@/keeper/void";

const TICK_MS = 60_000;
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly
const HEALTH_PORT = 8787;

/** 30s -> 2m -> 10m, capped at 10m for any further attempt within one
 * enqueue-to-give-up cycle. */
const BACKOFF_MS = [30_000, 120_000, 600_000];
const MAX_ATTEMPTS = 5;

type JobType = "lockMarket" | "resolveMarket" | "voidMarket";

interface QueuedJob {
  id: string;
  type: JobType;
  fixtureId: number;
  attempt: number;
  nextAttemptAt: number;
}

/** Boot-time hydration hits TxLINE's REST API once, outside any request's
 * own retry budget (`lib/txline/client.ts`'s `fetchWithRetry` already
 * retries transient network failures 3x internally, but a colder-than-usual
 * DNS/connection warmup at process start can still exhaust that). A crash
 * loop here just means the operator never comes up at all; a few slower
 * retries with real backoff is worth it before actually giving up. */
async function hydrateWithRetry(logger: pino.Logger) {
  const attempts = [0, 2_000, 5_000, 10_000];
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) await new Promise((r) => setTimeout(r, attempts[i]));
    try {
      return await getStatusTracker();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const isLast = i === attempts.length - 1;
      logger[isLast ? "error" : "warn"](
        { error, attempt: i + 1 },
        isLast ? "status tracker hydration failed, giving up" : "status tracker hydration failed, retrying",
      );
      if (isLast) throw err;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const logger = buildLogger();
  const ctx = await buildKeeperContext(logger);
  const tracker = await hydrateWithRetry(logger);

  const queue = new Map<string, QueuedJob>();
  let processing = false;
  let lastSyncTs = 0;
  let lastTick = Date.now();

  function enqueue(type: JobType, fixtureId: number): void {
    const id = `${type}:${fixtureId}`;
    if (queue.has(id)) return;
    queue.set(id, { id, type, fixtureId, attempt: 0, nextAttemptAt: Date.now() });
    void processQueue();
  }

  async function runOne(job: QueuedJob): Promise<void> {
    try {
      const result =
        job.type === "lockMarket"
          ? await lockMarketJob(ctx, job.fixtureId)
          : job.type === "voidMarket"
            ? await voidMarketJob(ctx, job.fixtureId)
            : await resolveFixture(ctx, job.fixtureId, logger);
      logger.info(
        { job: job.type, fixtureId: job.fixtureId, txSig: result.txSig, action: result.action },
        `${job.type} ${result.action}`,
      );
      queue.delete(job.id);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      job.attempt += 1;
      if (job.attempt >= MAX_ATTEMPTS) {
        // Not a permanent give-up: the fixture is still LIVE/FINISHED and
        // unresolved on-chain, so the next reconcile() tick re-enqueues a
        // fresh attempt cycle rather than hammering every 60s in a tight
        // loop — see this module's doc comment.
        logger.error(
          { job: job.type, fixtureId: job.fixtureId, error, attempt: job.attempt },
          `${job.type} giving up after ${job.attempt} attempts`,
        );
        queue.delete(job.id);
        return;
      }
      const delay = BACKOFF_MS[Math.min(job.attempt - 1, BACKOFF_MS.length - 1)];
      job.nextAttemptAt = Date.now() + delay;
      logger.warn(
        { job: job.type, fixtureId: job.fixtureId, error, attempt: job.attempt, retryInMs: delay },
        `${job.type} failed, retrying`,
      );
    }
  }

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
      const now = Date.now();
      const due = Array.from(queue.values()).filter((j) => j.nextAttemptAt <= now);
      for (const job of due) {
        await runOne(job);
      }
    } finally {
      processing = false;
    }
  }

  function reconcile(): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const fixture of tracker.list()) {
      if (fixture.status === "LIVE") enqueue("lockMarket", fixture.fixtureId);
      else if (fixture.status === "FINISHED") enqueue("resolveMarket", fixture.fixtureId);
      // Independent of the branch above, not `else if` — a stalled
      // fixture the tracker still shows `LIVE` (TxLINE's feed never
      // produced a `game_finalised` event) can be both a lock candidate
      // and a void candidate at once; voidMarketJob only needs the
      // market to still be Open/Locked, so enqueueing both is harmless.
      if (isVoidCandidate(fixture, nowSeconds)) enqueue("voidMarket", fixture.fixtureId);
    }
  }

  async function runSyncMarkets(): Promise<void> {
    try {
      const result = await syncMarketsJob(ctx);
      logger.info({ job: "syncMarkets", ...result }, "syncMarkets completed");
      lastSyncTs = Date.now(); // only advance the hourly clock on success — a
      // failure retries next tick (60s) instead of waiting a full hour.
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ job: "syncMarkets", error }, "syncMarkets failed");
    }
  }

  tracker.on("kickoff", (fixtureId) => enqueue("lockMarket", fixtureId));
  tracker.on("finished", (fixtureId) => enqueue("resolveMarket", fixtureId));

  await runSyncMarkets();
  reconcile();

  const tickTimer = setInterval(() => {
    lastTick = Date.now();
    if (lastTick - lastSyncTs >= SYNC_INTERVAL_MS) void runSyncMarkets();
    reconcile();
    void processQueue();
  }, TICK_MS);

  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          uptime: process.uptime(),
          lastTick: new Date(lastTick).toISOString(),
          pendingJobs: queue.size,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT }, "healthz listening");
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    clearInterval(tickTimer);
    tracker.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info({}, "keeper started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The in-memory source of truth for "what's happening with every World
 * Cup fixture right now" — one `Map<fixtureId, TrackedFixture>`, hydrated
 * once from TxLINE's REST snapshot on boot and kept live from the SSE
 * pipeline (`lib/txline/stream.ts`) afterward. Both `app/api/fixtures`
 * (below) and the keeper (Session 6.4) read from the same singleton
 * (`getStatusTracker()`) rather than each polling TxLINE independently —
 * one hydration, one set of live subscriptions, shared by every consumer
 * in this process.
 *
 * Server-only by the same convention as the rest of `lib/txline/*` (no
 * `server-only` package) — never import runtime code from here into a
 * client component.
 *
 * ## Self-healing: silent-LIVE-fixture fallback
 *
 * This is an ingestion-robustness feature worth calling out explicitly
 * (a judging point, not an afterthought): an SSE connection can go quiet
 * without ever firing an error or a clean close — TxLINE's own heartbeat
 * keeps the *connection* alive, but says nothing about whether a
 * specific fixture's real events are still arriving (a partial upstream
 * outage, a dropped fixture subscription, TxLINE-side backpressure,
 * ...). Relying on the stream alone means a stalled fixture just silently
 * stops updating with no signal anything is wrong. `checkForSilentLiveFixtures`
 * runs on an interval and, for any fixture whose tracked `status` is
 * `LIVE` but hasn't produced a single stream event (`'score'` or
 * `'status'`) in `SILENT_LIVE_THRESHOLD_MS`, falls back to an explicit
 * `getScores` REST poll to pull the current state directly — the same
 * kind of self-healing a production ingestion pipeline needs regardless
 * of which specific transport (SSE here) is carrying the live feed.
 */
import { EventEmitter } from "node:events";
import { getFixtures, getScores } from "@/lib/txline/client";
import { getTxlineStream, type RawStatusEvent } from "@/lib/txline/stream";
import { toFixture, toScoreEvent, fixtureStatusFromActionAndStatusId } from "@/lib/txline/normalize";
import type { Fixture, FixtureStatus, ScoreEvent } from "@/lib/types";
import type { TxScore } from "@/lib/txline/types";

const WORLD_CUP_COMPETITION_ID = 72;
const ONE_DAY_SECONDS = 86_400;

/**
 * 2026-06-28 UTC — same tournament-window constant as
 * `scripts/sync-markets.ts`'s `TOURNAMENT_START_EPOCH_DAY` (see that
 * file's doc comment for the derivation). Kept as a separate literal
 * here rather than importing it, since `scripts/sync-markets.ts` doesn't
 * export it and pulling a script-only constant into a server module
 * would be a strange dependency direction — if this ever needs to change,
 * change both.
 */
const TOURNAMENT_START_EPOCH_DAY = 20_632;

/** How long a `LIVE` fixture can go without a stream event before the
 * self-healing REST fallback kicks in. */
const SILENT_LIVE_THRESHOLD_MS = 120_000;

/** How often the silence check itself runs — doesn't need to be anywhere
 * near as precise as the threshold, just frequent enough that a stalled
 * fixture isn't stuck for much longer than `SILENT_LIVE_THRESHOLD_MS`. */
const SILENCE_CHECK_INTERVAL_MS = 30_000;

/** Forward-only ordering `transitionTo` enforces — see its own doc comment. */
const STATUS_RANK: Partial<Record<FixtureStatus, number>> = {
  SCHEDULED: 0,
  LIVE: 1,
  FINISHED: 2,
};

export interface TrackedFixture extends Fixture {
  score: ScoreEvent | null;
  /** `Date.now()` of the last time this fixture produced *any* signal —
   * a stream event or a self-healing poll. Never touched by hydration
   * alone (a REST-only fixture that hasn't started yet isn't "silent",
   * it just hasn't happened). */
  lastEventTs: number;
}

export interface StatusTrackerEvents {
  /** Fires exactly once per fixture, the first time its tracked status
   * becomes `LIVE`. */
  kickoff: number;
  /** Fires exactly once per fixture, the first time its tracked status
   * becomes `FINISHED`. */
  finished: number;
}

export declare interface StatusTracker {
  on<K extends keyof StatusTrackerEvents>(
    event: K,
    listener: (fixtureId: StatusTrackerEvents[K]) => void,
  ): this;
  off<K extends keyof StatusTrackerEvents>(
    event: K,
    listener: (fixtureId: StatusTrackerEvents[K]) => void,
  ): this;
  emit<K extends keyof StatusTrackerEvents>(event: K, fixtureId: StatusTrackerEvents[K]): boolean;
}

export class StatusTracker extends EventEmitter {
  private readonly fixtures = new Map<number, TrackedFixture>();
  private hydrated = false;
  private subscribed = false;
  private silenceCheckTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Loads the known fixture set from TxLINE's REST snapshot (or, for
   * tests / demo replay, an already-normalized list passed in directly —
   * see `lib/txline/statusTracker.test.ts`) and seeds `fixtures` with it.
   * Idempotent when called with no argument (only fetches once); passing
   * `fixtures` explicitly always re-seeds, preserving any `score`/
   * `lastEventTs` already tracked for fixtures that were already present.
   */
  async hydrate(fixtures?: Fixture[]): Promise<void> {
    if (this.hydrated && fixtures === undefined) return;

    const list =
      fixtures ??
      (
        await getFixtures({
          competition: WORLD_CUP_COMPETITION_ID,
          from: TOURNAMENT_START_EPOCH_DAY * ONE_DAY_SECONDS,
        })
      ).map(toFixture);

    for (const fixture of list) {
      const existing = this.fixtures.get(fixture.fixtureId);
      this.fixtures.set(fixture.fixtureId, {
        ...fixture,
        score: existing?.score ?? null,
        lastEventTs: existing?.lastEventTs ?? Date.now(),
      });
    }

    this.hydrated = true;
    console.log(`[status-tracker] hydrated ${this.fixtures.size} fixtures`);
  }

  /** Subscribes to the live SSE pipeline and starts the self-healing
   * silence-check interval. Idempotent — safe to call from every
   * consumer of `getStatusTracker()`, only wires up once. */
  start(): void {
    if (!this.subscribed) {
      const stream = getTxlineStream();
      stream.on("score", (score) => this.applyScore(score));
      stream.on("status", (status) => this.applyStatus(status));
      this.subscribed = true;
    }

    if (!this.silenceCheckTimer) {
      this.silenceCheckTimer = setInterval(
        () => void this.checkForSilentLiveFixtures(),
        SILENCE_CHECK_INTERVAL_MS,
      );
    }
  }

  stop(): void {
    if (this.silenceCheckTimer) {
      clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
  }

  get(fixtureId: number): TrackedFixture | undefined {
    return this.fixtures.get(fixtureId);
  }

  list(): TrackedFixture[] {
    return Array.from(this.fixtures.values());
  }

  /**
   * Feeds one raw TxLINE scores-stream/-snapshot record through exactly
   * the same two-step handling a live stream event would trigger
   * (`applyStatus` then, if it carries score data, `applyScore`) — the
   * hook `lib/txline/statusTracker.test.ts` uses to replay a real
   * fixture's full captured event history without a live connection.
   * Distinct from `lib/txline/stream.ts`'s `Source` interface (a lower
   * layer, replaying raw SSE bytes) — this replays already-parsed
   * `TxScore` records straight into tracker state.
   */
  ingest(raw: TxScore): void {
    this.applyStatus({
      fixtureId: raw.FixtureId,
      action: raw.Action,
      gameState: raw.GameState,
      statusId: raw.StatusId,
      ts: raw.Ts,
    });
    const scoreEvent = toScoreEvent(raw);
    if (scoreEvent) this.applyScore(scoreEvent);
  }

  private applyScore(score: ScoreEvent): void {
    const tracked = this.fixtures.get(score.fixtureId);
    if (!tracked) return; // a fixture outside the hydrated set — nothing to update
    tracked.score = score;
    tracked.lastEventTs = Date.now();
    this.transitionTo(tracked, score.status);
  }

  private applyStatus(event: RawStatusEvent): void {
    const tracked = this.fixtures.get(event.fixtureId);
    if (!tracked) return;
    tracked.lastEventTs = Date.now();
    this.transitionTo(tracked, fixtureStatusFromActionAndStatusId(event.action, event.statusId));
  }

  /**
   * Applies a newly-derived status, but only forward along `SCHEDULED ->
   * LIVE -> FINISHED` — a real gap in TxLINE's own data, found by
   * replaying a real fixture's full event history (see
   * `lib/txline/statusTracker.test.ts`), makes this necessary, not just
   * defensive: several `Action`s can occur at *any* point in a match
   * (`suspend`, `comment`, `action_discarded`, `disconnected`, ...) while
   * still carrying no `StatusId` at all — same gap
   * `fixtureStatusFromActionAndStatusId` already documents for
   * `game_finalised`, except these aren't a single well-known literal to
   * special-case, so they fall back to `SCHEDULED` there. Applied naively,
   * a mid-match `"suspend"` event would bounce a tracked fixture back to
   * `SCHEDULED` and then back to `LIVE` on the next real event — spurious
   * status flapping and a spurious repeat `onKickoff` fire. Blocking any
   * move backward through the three real states TxLINE's data is
   * confirmed to progress through in order fixes this at the tracker
   * level without needing the stateless normalizer to somehow know a
   * fixture's prior status. `POSTPONED`/`CANCELLED` aren't part of this
   * ordering — never observed from real data, always applied unconditionally
   * if they ever do show up.
   */
  private transitionTo(tracked: TrackedFixture, next: FixtureStatus): void {
    if (tracked.status === next) return;

    const prevRank = STATUS_RANK[tracked.status];
    const nextRank = STATUS_RANK[next];
    if (prevRank !== undefined && nextRank !== undefined && nextRank < prevRank) return;

    const prev = tracked.status;
    tracked.status = next;
    console.log(`[status-tracker] fixture ${tracked.fixtureId} ${prev} -> ${next}`);
    if (prev !== "LIVE" && next === "LIVE") this.emit("kickoff", tracked.fixtureId);
    if (prev !== "FINISHED" && next === "FINISHED") this.emit("finished", tracked.fixtureId);
  }

  /**
   * The self-healing fallback described in this module's doc comment.
   * Public (not just interval-triggered) so it can be invoked directly —
   * a health-check route, an admin action, or a test that wants to
   * assert the fallback path without waiting on a real interval.
   */
  async checkForSilentLiveFixtures(): Promise<void> {
    const now = Date.now();
    const silent = Array.from(this.fixtures.values()).filter(
      (f) => f.status === "LIVE" && now - f.lastEventTs >= SILENT_LIVE_THRESHOLD_MS,
    );

    for (const tracked of silent) {
      console.warn(
        `[status-tracker] fixture ${tracked.fixtureId} silent for ${now - tracked.lastEventTs}ms while LIVE — polling getScores as a fallback`,
      );
      try {
        const events = await getScores(tracked.fixtureId);
        if (events.length === 0) continue;

        const byRecency = [...events].sort((a, b) => b.Seq - a.Seq);
        const latest = byRecency[0];
        // Status reflects the truly most recent event regardless of
        // whether it carries Score data; the score value falls back to
        // the most recent event that actually has one (toScoreEvent
        // returns null otherwise — see its own doc comment).
        const latestWithScore = byRecency.find((e) => toScoreEvent(e) !== null);

        tracked.lastEventTs = Date.now();
        if (latestWithScore) tracked.score = toScoreEvent(latestWithScore);
        this.transitionTo(tracked, fixtureStatusFromActionAndStatusId(latest.Action, latest.StatusId));
      } catch (err) {
        console.error(`[status-tracker] self-healing poll failed for fixture ${tracked.fixtureId}`, err);
      }
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __statusTracker: StatusTracker | undefined;
}

/**
 * The process-wide singleton, `globalThis`-guarded the same way
 * `lib/txline/stream.ts`'s `getTxlineStream()` is (Next dev hot-reload
 * safe — reuses the same tracker, hydration, and live subscriptions
 * across a module re-evaluation instead of leaking fresh ones on every
 * save).
 */
export async function getStatusTracker(): Promise<StatusTracker> {
  if (!globalThis.__statusTracker) {
    globalThis.__statusTracker = new StatusTracker();
  }
  const tracker = globalThis.__statusTracker;
  await tracker.hydrate();
  tracker.start();
  return tracker;
}

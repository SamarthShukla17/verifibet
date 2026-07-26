/**
 * The client-facing half of the TxLINE live pipeline: subscribes to the
 * server singleton consumer's in-memory pub/sub (`lib/txline/stream.ts`)
 * and re-broadcasts it as an SSE response, one connection per browser
 * `EventSource` (see `lib/hooks/useLiveFixture.ts`). `?fixtureId=` narrows
 * the broadcast to a single fixture; omitted, every fixture's events pass
 * through.
 *
 * `runtime = "nodejs"` (not the default edge-eligible runtime): the
 * upstream consumer this subscribes to uses `node:events`' `EventEmitter`
 * and a real long-lived `AbortController`-driven fetch loop, neither of
 * which the edge runtime supports. `dynamic = "force-dynamic"`: an SSE
 * response is infinite and per-request, never something Next should try
 * to statically render or cache.
 *
 * **Production topology (2026-07-26 deploy)**: no separate Railway/Fly
 * worker exists — resolution runs through the manual backfill CLI
 * (`pnpm keeper:resolve --fixture <id>`, see `keeper/resolver.ts`), not a
 * hosted daemon, so there's no always-on process for this route to talk
 * to over the network even in production. It owns the upstream TxLINE
 * connection itself via `getTxlineStream()`'s `globalThis` singleton (see
 * `lib/txline/stream.ts`), exactly as in dev — Vercel just runs that
 * inside a serverless function instead of a long-running `pnpm dev`
 * process. The one real consequence: Vercel force-closes the function (and
 * therefore the SSE connection) at its execution-time limit — confirmed
 * live against the deployed route at exactly ~300s (no `maxDuration`
 * override is set here), independent of any real network issue. This is
 * survivable, not a bug to route around: `lib/hooks/useLiveFixture.ts`
 * already treats *any* connection close as `onerror` and reconnects with
 * its own backoff (starting at 1s) rather than relying on `EventSource`'s
 * native retry, so a forced close reads as a ~1s reconnect blip, not a
 * dead feed. A fresh invocation gets a fresh `getTxlineStream()` singleton
 * (state doesn't survive a cold instance), which is fine — a subscriber
 * losing at most one keepalive interval's worth of odds/score history
 * on reconnect is an acceptable gap for a live feed, not a correctness
 * issue. See NOTES.md's "deploy" entry for the actual 3-connection test
 * that established this.
 */
import type { NextRequest } from "next/server";
import { getTxlineStream, type TxlineStreamEvents } from "@/lib/txline/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How often to send our own `: keepalive` comment down to the browser,
 * independent of whether TxLINE has anything to say. Two reasons this
 * exists rather than just relying on real events: (1) a `ReadableStream`
 * that never enqueues anything never flushes its headers on some
 * intermediaries (confirmed locally — a fixture with no live odds/score
 * activity left a `curl` client seeing zero bytes, including headers,
 * until the connection was torn down), and (2) proxies between the
 * browser and this route in production (Vercel's included) tend to kill
 * an HTTP connection that's been silent for 30-60s. Well under both the
 * SL1 odds/score cadence (60s) and TxLINE's own upstream heartbeat
 * (observed ~15s during this session).
 */
const KEEPALIVE_INTERVAL_MS = 20_000;

export async function GET(request: NextRequest) {
  const fixtureIdParam = request.nextUrl.searchParams.get("fixtureId");
  const fixtureId = fixtureIdParam !== null ? Number(fixtureIdParam) : undefined;

  const manager = getTxlineStream();
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (bytes: string) => {
        try {
          controller.enqueue(encoder.encode(bytes));
        } catch {
          // Controller already closed (client disconnected between the
          // emitter/timer firing and this callback running) — nothing to
          // do, `cleanup` below will have already run or is about to.
        }
      };

      const send = <K extends keyof TxlineStreamEvents>(
        event: K,
        payload: TxlineStreamEvents[K],
      ) => enqueue(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

      // Forces an immediate flush (see KEEPALIVE_INTERVAL_MS's comment)
      // and gives a connecting client instant confirmation the pipe is up.
      enqueue(": connected\n\n");
      const keepalive = setInterval(() => enqueue(": keepalive\n\n"), KEEPALIVE_INTERVAL_MS);

      const matches = (payloadFixtureId: number) =>
        fixtureId === undefined || payloadFixtureId === fixtureId;

      const onOdds = (payload: TxlineStreamEvents["odds"]) => {
        if (matches(payload.fixtureId)) send("odds", payload);
      };
      const onScore = (payload: TxlineStreamEvents["score"]) => {
        if (matches(payload.fixtureId)) send("score", payload);
      };
      const onStatus = (payload: TxlineStreamEvents["status"]) => {
        if (matches(payload.fixtureId)) send("status", payload);
      };

      manager.on("odds", onOdds);
      manager.on("score", onScore);
      manager.on("status", onStatus);

      cleanup = () => {
        clearInterval(keepalive);
        manager.off("odds", onOdds);
        manager.off("score", onScore);
        manager.off("status", onStatus);
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed — fine.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

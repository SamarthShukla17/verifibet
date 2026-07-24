/**
 * `Source` implementation that replays a recorded `demo-data/scenarios/<name>.ndjson`
 * file instead of connecting to TxLINE — the demo-replay `Source`
 * `lib/txline/stream.ts`'s own doc comment named as "planned for Session
 * 7.1" when it defined the `Source` interface specifically so
 * `TxlineStream` would never need to change to support this.
 *
 * One `ReplaySource` instance replays exactly one `kind` ("odds" or
 * "scores") from one scenario — `lib/txline/stream.ts`'s
 * `TxlineStreamManager` constructs two (one per kind) per active demo
 * scenario, the same "one `TxlineStream` per upstream kind" shape it
 * already uses for the two real `NetworkSource`-backed streams. Both
 * `ReplaySource` instances for a scenario read the *same* `.ndjson` file
 * and each filter to their own `event` field — deliberately not a single
 * shared reader multiplexing to two consumers, since that would need its
 * own synchronization; two independent readers naturally interleave
 * correctly anyway, because both start their `t=0` reference at
 * (essentially) the same wall-clock instant (`TxlineStreamManager`
 * constructs and starts both synchronously, microseconds apart).
 */
import { readFileSync } from "node:fs";
import type { RawSseEvent, Source, StreamKind } from "@/lib/txline/stream";
import { getDemoSpeed, scenarioNdjsonPath } from "@/lib/txline/demoScenarios";

interface NdjsonLine {
  /** ms since the scenario's own t=0 — see `scripts/build-demo-scenario.ts`. */
  t: number;
  event: "scores" | "odds";
  data: unknown;
}

/** `StreamKind` is `"odds" | "scores"` — matches the ndjson's own `event`
 * field exactly, so no translation table is needed between the two. */
function readLines(scenario: string, kind: StreamKind): NdjsonLine[] {
  const raw = readFileSync(scenarioNdjsonPath(scenario), "utf-8");
  const lines: NdjsonLine[] = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as NdjsonLine);

  // Defensive, not required by the current build script (which already
  // writes the file pre-sorted) — a `Source` that silently misorders
  // events on a future scenario would be a much stranger bug to track
  // down than one extra sort here.
  return lines.filter((l) => l.event === kind).sort((a, b) => a.t - b.t);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface ReplaySourceOptions {
  /** `demo-data/scenarios/<scenario>.ndjson`'s basename. */
  scenario: string;
  kind: StreamKind;
  /** Real-ms-per-replayed-ms divisor — defaults to `DEMO_SPEED`
   * (`lib/txline/demoScenarios.ts#getDemoSpeed`, itself defaulting to 60).
   * A 2-hour recording plays back in 2 minutes at the default. */
  speed?: number;
  /** Replay the scenario again from the top once it ends, rather than
   * holding the final state forever. Off by default — see this module's
   * doc comment and the class doc comment below for why "holding" needs
   * no special code. */
  loop?: boolean;
  /** Pause before restarting when `loop` is on — a dramatic instant reset
   * from "full time, penalties decided" straight back to "kickoff" would
   * read as a glitch, not a replay. */
  loopDelayMs?: number;
}

const DEFAULT_LOOP_DELAY_MS = 5_000;

/**
 * Replays one `kind`'s events from a recorded scenario, waiting
 * `(event.t - previousEvent.t) / speed` between each — real inter-event
 * timing, just compressed. Yields nothing further after the last event
 * unless `loop` is set: `TxlineStream.consume()`'s `for await` loop simply
 * exits when this generator returns, same as a `NetworkSource` whose
 * connection closed cleanly, and nothing re-emits or resets whatever
 * `StatusTracker`/`useLiveFixture` last received — "holding the final
 * state" is what *not* sending anything more already means, not a
 * distinct behavior this class has to implement.
 */
export class ReplaySource implements Source {
  constructor(private readonly options: ReplaySourceOptions) {}

  async *connect(signal?: AbortSignal): AsyncIterable<RawSseEvent> {
    const lines = readLines(this.options.scenario, this.options.kind);
    const speed = this.options.speed ?? getDemoSpeed();
    const loopDelayMs = this.options.loopDelayMs ?? DEFAULT_LOOP_DELAY_MS;

    if (lines.length === 0) return;

    do {
      let previousT = 0;
      for (const line of lines) {
        if (signal?.aborted) return;
        const waitMs = (line.t - previousT) / speed;
        if (waitMs > 0) await sleep(waitMs, signal);
        if (signal?.aborted) return;
        previousT = line.t;

        yield { event: this.options.kind, data: JSON.stringify(this.rewriteTs(line.data)) };
      }

      if (this.options.loop && !signal?.aborted) {
        await sleep(loopDelayMs, signal);
      }
    } while (this.options.loop && !signal?.aborted);
  }

  /**
   * Rewrites an odds line's `Ts` to the actual moment of replay,
   * discarding the file's real historical capture timestamp — odds-only,
   * scores are left untouched. `OddsChart.tsx`'s "updated Ns ago" ticker
   * reads `OddsSnapshot.ts` straight against `Date.now()`; the real
   * captured `Ts` is weeks in the past by the time anyone replays this
   * scenario, which would show a nonsensical "updated 2,000,000s ago"
   * instead of a live-feeling tick. Nothing about the *odds values*
   * changes — those are what's being demonstrated; only the "when" of a
   * quote that was never real to begin with (see
   * `scripts/build-demo-scenario.ts`'s doc comment) gets an honest,
   * current answer instead of a confusing one.
   */
  private rewriteTs(data: unknown): unknown {
    if (this.options.kind !== "odds" || typeof data !== "object" || data === null) return data;
    return { ...data, Ts: Date.now() };
  }
}

/**
 * `Source` implementation that replays a recorded `demo-data/scenarios/<name>.ndjson`
 * file instead of connecting to TxLINE — the demo-replay `Source`
 * `lib/txline/stream.ts`'s own doc comment named as "planned for Session
 * 7.1" when it defined the `Source` interface specifically so
 * `TxlineStream` would never need to change to support it.
 *
 * One `ReplaySource` instance replays exactly one `kind` ("odds" or
 * "scores") from one scenario — `lib/txline/stream.ts`'s
 * `TxlineStreamManager` constructs two (one per kind) per active demo
 * scenario, the same "one `TxlineStream` per upstream kind" shape it
 * already uses for the two real `NetworkSource`-backed streams. Both
 * `ReplaySource` instances for a scenario read the *same* `.ndjson` file
 * and each filter to their own `event` field.
 *
 * ## Live control (Session 7.3)
 *
 * Speed, pause/play, and chapter jumps (`components/DemoControlPopover.tsx`,
 * `POST /api/demo/control`) work by mutating `lib/txline/demoControl.ts`'s
 * shared in-memory state — `waitContentMs` below polls it every
 * `POLL_INTERVAL_MS` while waiting for the next event, exactly the
 * "shared control object the ReplaySource polls between events" shape
 * this was speced against, not a push/subscribe mechanism. Both
 * instances (odds + scores) poll the same shared state independently and
 * converge on the same jump target without needing to coordinate with
 * each other directly.
 */
import { readFileSync } from "node:fs";
import type { RawSseEvent, Source, StreamKind } from "@/lib/txline/stream";
import { scenarioNdjsonPath } from "@/lib/txline/demoScenarios";
import { getDemoControlState } from "@/lib/txline/demoControl";

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
  /** Replay the scenario again from the top once it ends, rather than
   * holding the final state forever. Off by default. */
  loop?: boolean;
  /** Pause before restarting when `loop` is on — a dramatic instant reset
   * from "full time, penalties decided" straight back to "kickoff" would
   * read as a glitch, not a replay. */
  loopDelayMs?: number;
}

const DEFAULT_LOOP_DELAY_MS = 5_000;
/** Real ms between control-state checks while waiting for the next event
 * — bounds how quickly a pause/speed/jump takes visible effect,
 * independent of the current playback speed (a 100-150ms real delay
 * reads as instant to a narrator; this is not "poll once per scheduled
 * event", it's "poll continuously while idle between them"). */
const POLL_INTERVAL_MS = 120;

/**
 * Replays one `kind`'s events from a recorded scenario, waiting
 * `(event.t - previousEvent.t) / speed` between each — real inter-event
 * timing, just compressed, with `speed` and position both live-adjustable
 * mid-replay via `lib/txline/demoControl.ts`. Yields nothing further
 * after the last event unless `loop` is set: `TxlineStream.consume()`'s
 * `for await` loop simply exits when this generator returns, same as a
 * `NetworkSource` whose connection closed cleanly — "holding the final
 * state" is what *not* sending anything more already means.
 */
export class ReplaySource implements Source {
  constructor(private readonly options: ReplaySourceOptions) {}

  async *connect(signal?: AbortSignal): AsyncIterable<RawSseEvent> {
    const lines = readLines(this.options.scenario, this.options.kind);
    if (lines.length === 0) return;

    do {
      let index = 0;
      let previousT = 0;
      let ackedJumpGeneration = getDemoControlState().jumpGeneration;

      while (index < lines.length) {
        if (signal?.aborted) return;

        const line = lines[index];
        const jumped = await this.waitContentMs(line.t - previousT, ackedJumpGeneration, signal);
        if (signal?.aborted) return;

        if (jumped) {
          const control = getDemoControlState();
          ackedJumpGeneration = control.jumpGeneration;
          let nextIndex = lines.findIndex((l) => l.t >= control.jumpTargetT);
          if (nextIndex === -1) nextIndex = lines.length;
          index = nextIndex;
          previousT = control.jumpTargetT;
          continue;
        }

        yield { event: this.options.kind, data: JSON.stringify(this.rewriteTs(line.data)) };
        previousT = line.t;
        index++;
      }

      if (this.options.loop && !signal?.aborted) {
        await sleep(this.options.loopDelayMs ?? DEFAULT_LOOP_DELAY_MS, signal);
      }
    } while (this.options.loop && !signal?.aborted);
  }

  /**
   * Waits `targetContentMs` of *content* time, consumed at whatever the
   * live `speed` is on each `POLL_INTERVAL_MS` real-time tick (so a speed
   * change mid-wait shortens/lengthens what's left of *this* wait too,
   * not just future ones), frozen entirely while `paused`. Returns `true`
   * — abandoning the wait immediately — the moment it notices
   * `jumpGeneration` has moved past `ackedJumpGeneration`, i.e. a jump was
   * requested since the caller last acted on one.
   */
  private async waitContentMs(
    targetContentMs: number,
    ackedJumpGeneration: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    let remaining = targetContentMs;

    while (remaining > 0) {
      if (signal?.aborted) return false;
      if (getDemoControlState().jumpGeneration !== ackedJumpGeneration) return true;

      await sleep(POLL_INTERVAL_MS, signal);
      if (signal?.aborted) return false;

      const control = getDemoControlState();
      if (control.jumpGeneration !== ackedJumpGeneration) return true;
      if (!control.paused) remaining -= POLL_INTERVAL_MS * control.speed;
    }

    return false;
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

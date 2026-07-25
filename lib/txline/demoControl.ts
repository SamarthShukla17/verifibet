/**
 * The shared, in-memory control state `POST /api/demo/control` mutates
 * and every active `lib/txline/replaySource.ts#ReplaySource` instance
 * polls between events — speed, pause/play, and chapter jumps for
 * narrating a demo replay live (`components/DemoControlPopover.tsx`).
 * `globalThis`-guarded the same way `getTxlineStream`/`getStatusTracker`
 * are, so Next dev's hot-reload reuses the same state across a module
 * re-evaluation instead of resetting playback position on every save.
 *
 * **Keyed per scenario** (Session 7.4) — `lib/txline/stream.ts`'s
 * `TxlineStreamManager` already runs one `ReplaySource` pair per
 * *registered* scenario concurrently, not just the one the pill happens
 * to be showing (see that module's own doc comment), so a single shared
 * state would mean jumping one scenario's chapters also yanked every
 * other scenario's replay to the same (likely out-of-range) offset. Each
 * scenario gets its own independent `speed`/`paused`/jump position;
 * narrating one demo match never affects another's.
 *
 * **Known limitation, stated plainly rather than silently papered over**:
 * jumping *backward* (e.g. "Kickoff" after already reaching "Full-time")
 * correctly rewinds the replay position `ReplaySource` reads from, so
 * score/odds values genuinely go back to their earlier state — but
 * `StatusTracker.transitionTo` only ever allows a fixture's *status*
 * forward (`SCHEDULED -> LIVE -> FINISHED`, see that method's own doc
 * comment), by design, to guard against real feed flicker. A backward
 * jump does not undo an already-reached `FINISHED` status. For a
 * narration tool this is an acceptable, documented tradeoff (jumping
 * forward through chapters — the actual narration use case — is
 * unaffected); a full state reset would mean tearing down and
 * re-hydrating the tracked fixture, out of scope here.
 */
import { getDemoSpeed } from "@/lib/txline/demoScenarios";

export interface DemoControlState {
  /** Content-ms replayed per real ms. */
  speed: number;
  paused: boolean;
  /** Bumped every time `jumpTo` is called — each `ReplaySource` instance
   * compares this against the generation it last acted on to notice a
   * new jump request. Two independent instances (odds + scores) share
   * this one counter and both react to the same jump. */
  jumpGeneration: number;
  /** ms since the scenario's own t=0 — where the next jump should land. */
  jumpTargetT: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __demoControl: Map<string, DemoControlState> | undefined;
}

function stateMap(): Map<string, DemoControlState> {
  if (!globalThis.__demoControl) {
    globalThis.__demoControl = new Map();
  }
  return globalThis.__demoControl;
}

function state(scenario: string): DemoControlState {
  const map = stateMap();
  let s = map.get(scenario);
  if (!s) {
    s = { speed: getDemoSpeed(), paused: false, jumpGeneration: 0, jumpTargetT: 0 };
    map.set(scenario, s);
  }
  return s;
}

/** A snapshot, not a live reference — callers should re-call this rather
 * than cache the result across an `await`, exactly the "poll between
 * events" shape this module exists for. */
export function getDemoControlState(scenario: string): DemoControlState {
  return { ...state(scenario) };
}

export function setDemoSpeed(scenario: string, speed: number): void {
  state(scenario).speed = Math.max(1, Math.min(240, speed));
}

export function setDemoPaused(scenario: string, paused: boolean): void {
  state(scenario).paused = paused;
}

/** Jumping always resumes playback (`paused = false`) — the narration use
 * case is "skip to the goal and keep going," not "skip to the goal and
 * sit there paused." */
export function jumpDemoTo(scenario: string, t: number): void {
  const s = state(scenario);
  s.jumpTargetT = Math.max(0, t);
  s.jumpGeneration += 1;
  s.paused = false;
}

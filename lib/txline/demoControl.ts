/**
 * The shared, in-memory control state `POST /api/demo/control` mutates
 * and every active `lib/txline/replaySource.ts#ReplaySource` instance
 * polls between events — speed, pause/play, and chapter jumps for
 * narrating a demo replay live (`components/DemoControlPopover.tsx`).
 * `globalThis`-guarded the same way `getTxlineStream`/`getStatusTracker`
 * are, so Next dev's hot-reload reuses the same state across a module
 * re-evaluation instead of resetting playback position on every save.
 *
 * One shared state, not per-scenario: this app runs exactly one active
 * demo scenario at a time (see `lib/txline/demoScenarios.ts`'s own doc
 * comment), so there's nothing to key control state on yet.
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
  var __demoControl: DemoControlState | undefined;
}

function state(): DemoControlState {
  if (!globalThis.__demoControl) {
    globalThis.__demoControl = {
      speed: getDemoSpeed(),
      paused: false,
      jumpGeneration: 0,
      jumpTargetT: 0,
    };
  }
  return globalThis.__demoControl;
}

/** A snapshot, not a live reference — callers should re-call this rather
 * than cache the result across an `await`, exactly the "poll between
 * events" shape this module exists for. */
export function getDemoControlState(): DemoControlState {
  return { ...state() };
}

export function setDemoSpeed(speed: number): void {
  state().speed = Math.max(1, Math.min(240, speed));
}

export function setDemoPaused(paused: boolean): void {
  state().paused = paused;
}

/** Jumping always resumes playback (`paused = false`) — the narration use
 * case is "skip to the goal and keep going," not "skip to the goal and
 * sit there paused." */
export function jumpDemoTo(t: number): void {
  const s = state();
  s.jumpTargetT = Math.max(0, t);
  s.jumpGeneration += 1;
  s.paused = false;
}

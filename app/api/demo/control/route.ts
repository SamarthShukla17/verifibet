/**
 * GET/POST /api/demo/control — live playback control for one demo
 * scenario, selected by `?scenario=<name>` (GET) or the body's
 * `scenario` field (POST) — defaults to `pickDefaultScenario()`'s pick
 * (most-real-first) when omitted, matching `/api/demo`'s own default.
 * `POST` mutates `lib/txline/demoControl.ts`'s in-memory state for that
 * one scenario, which every running `lib/txline/replaySource.ts#ReplaySource`
 * instance for it polls between events — this route never touches the
 * replay pipeline directly, it only ever writes the state object
 * `ReplaySource` already knows how to read. Controlling one scenario
 * never affects any other's independently-running replay (Session 7.4 —
 * see `demoControl.ts`'s own doc comment for why this had to become
 * per-scenario once more than one was registered).
 *
 * `GET` exists so `components/DemoControlPopover.tsx` can initialize (and
 * stay in sync with) `speed`/`paused` on mount — control state is server
 * process state, not something the client can assume from its own last
 * action alone (a keyboard shortcut fired from a different tab, or this
 * same popover being reopened after a full page reload, both need a real
 * answer, not a guessed default).
 *
 * A no-op (`{ok: true}` regardless) when `DEMO_MODE` is off — there is no
 * replay for these controls to affect, and returning an error for
 * something that isn't actually broken would be its own kind of
 * dishonesty this app tries hard to avoid elsewhere in the demo tooling.
 */
import { NextResponse } from "next/server";
import { isDemoModeEnabled, findScenarioByName, pickDefaultScenario } from "@/lib/txline/demoScenarios";
import { getDemoControlState, jumpDemoTo, setDemoPaused, setDemoSpeed } from "@/lib/txline/demoControl";

export const runtime = "nodejs";

export interface DemoControlResponse {
  scenario: string | null;
  speed: number;
  paused: boolean;
}

function resolveScenario(requested: string | null): string | null {
  if (requested) return findScenarioByName(requested)?.meta.scenario ?? null;
  return pickDefaultScenario()?.meta.scenario ?? null;
}

function toResponse(scenario: string | null): DemoControlResponse {
  if (!scenario) return { scenario: null, speed: 1, paused: true };
  const state = getDemoControlState(scenario);
  return { scenario, speed: state.speed, paused: state.paused };
}

export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get("scenario");
  return NextResponse.json<DemoControlResponse>(toResponse(resolveScenario(requested)));
}

type ControlMessage =
  | { type: "speed"; value: number; scenario?: string }
  | { type: "jumpTo"; t: number; scenario?: string }
  | { type: "trigger"; action: "pause" | "play"; scenario?: string };

export async function POST(req: Request) {
  if (!isDemoModeEnabled()) {
    return NextResponse.json({ ok: true, note: "DEMO_MODE is off — no-op" });
  }

  let message: ControlMessage;
  try {
    message = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const scenario = resolveScenario(message.scenario ?? null);
  if (!scenario) {
    return NextResponse.json({ error: "no demo scenario registered" }, { status: 404 });
  }

  switch (message.type) {
    case "speed": {
      if (typeof message.value !== "number" || !Number.isFinite(message.value)) {
        return NextResponse.json({ error: "speed.value must be a finite number" }, { status: 400 });
      }
      setDemoSpeed(scenario, message.value);
      break;
    }
    case "jumpTo": {
      if (typeof message.t !== "number" || !Number.isFinite(message.t)) {
        return NextResponse.json({ error: "jumpTo.t must be a finite number" }, { status: 400 });
      }
      jumpDemoTo(scenario, message.t);
      break;
    }
    case "trigger": {
      if (message.action !== "pause" && message.action !== "play") {
        return NextResponse.json({ error: 'trigger.action must be "pause" or "play"' }, { status: 400 });
      }
      setDemoPaused(scenario, message.action === "pause");
      break;
    }
    default:
      return NextResponse.json({ error: `unknown control type "${(message as { type?: unknown }).type}"` }, { status: 400 });
  }

  return NextResponse.json<DemoControlResponse>(toResponse(scenario));
}

/**
 * GET/POST /api/demo/control — live playback control for the active demo
 * scenario. `POST` mutates `lib/txline/demoControl.ts`'s shared in-memory
 * state, which every running `lib/txline/replaySource.ts#ReplaySource`
 * instance polls between events — this route never touches the replay
 * pipeline directly, it only ever writes the one shared state object
 * `ReplaySource` already knows how to read.
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
import { isDemoModeEnabled } from "@/lib/txline/demoScenarios";
import { getDemoControlState, jumpDemoTo, setDemoPaused, setDemoSpeed } from "@/lib/txline/demoControl";

export const runtime = "nodejs";

export interface DemoControlResponse {
  speed: number;
  paused: boolean;
}

function toResponse(): DemoControlResponse {
  const state = getDemoControlState();
  return { speed: state.speed, paused: state.paused };
}

export async function GET() {
  return NextResponse.json<DemoControlResponse>(toResponse());
}

type ControlMessage =
  | { type: "speed"; value: number }
  | { type: "jumpTo"; t: number }
  | { type: "trigger"; action: "pause" | "play" };

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

  switch (message.type) {
    case "speed": {
      if (typeof message.value !== "number" || !Number.isFinite(message.value)) {
        return NextResponse.json({ error: "speed.value must be a finite number" }, { status: 400 });
      }
      setDemoSpeed(message.value);
      break;
    }
    case "jumpTo": {
      if (typeof message.t !== "number" || !Number.isFinite(message.t)) {
        return NextResponse.json({ error: "jumpTo.t must be a finite number" }, { status: 400 });
      }
      jumpDemoTo(message.t);
      break;
    }
    case "trigger": {
      if (message.action !== "pause" && message.action !== "play") {
        return NextResponse.json({ error: 'trigger.action must be "pause" or "play"' }, { status: 400 });
      }
      setDemoPaused(message.action === "pause");
      break;
    }
    default:
      return NextResponse.json({ error: `unknown control type "${(message as { type?: unknown }).type}"` }, { status: 400 });
  }

  return NextResponse.json<DemoControlResponse>(toResponse());
}

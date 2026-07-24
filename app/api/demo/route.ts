/**
 * GET /api/demo — whether `DEMO_MODE` is on and, if so, what
 * `components/DemoReplayBanner.tsx`'s persistent pill should say. A
 * client component can't read the server-only `DEMO_MODE` env var
 * directly (and shouldn't need a `NEXT_PUBLIC_` mirror just for this one
 * boolean — same "server env decides, client asks" shape as
 * `app/api/keeper/status`), so this is the one place that answers it.
 *
 * Only the first registered scenario's meta is surfaced — this app runs
 * one active demo scenario at a time today; a scenario picker is
 * Session 7.3's job (the same session the pill's click handler defers
 * to), not this route's.
 */
import { NextResponse } from "next/server";
import { getDemoSpeed, isDemoModeEnabled, loadDemoScenarios } from "@/lib/txline/demoScenarios";

export const runtime = "nodejs";

export interface DemoStatusResponse {
  active: boolean;
  label: string | null;
  speed: number | null;
}

export async function GET() {
  if (!isDemoModeEnabled()) {
    return NextResponse.json<DemoStatusResponse>({ active: false, label: null, speed: null });
  }

  const [scenario] = loadDemoScenarios();
  return NextResponse.json<DemoStatusResponse>({
    active: true,
    label: scenario?.meta.label ?? null,
    speed: getDemoSpeed(),
  });
}

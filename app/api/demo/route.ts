/**
 * GET /api/demo — whether `DEMO_MODE` is on and, if so, what
 * `components/DemoReplayBanner.tsx`'s persistent pill (and its popover,
 * `components/DemoControlPopover.tsx`) should show. A client component
 * can't read the server-only `DEMO_MODE` env var directly (and shouldn't
 * need a `NEXT_PUBLIC_` mirror just for this one boolean — same "server
 * env decides, client asks" shape as `app/api/keeper/status`), so this is
 * the one place that answers it.
 *
 * Only the first registered scenario's meta/chapters are surfaced — this
 * app runs one active demo scenario at a time (see
 * `lib/txline/demoScenarios.ts`'s own doc comment); a scenario picker
 * isn't built yet. Live playback control (speed/pause/jump) is a
 * separate concern — see `app/api/demo/control/route.ts` — this route is
 * read-only, static-per-scenario status.
 */
import { NextResponse } from "next/server";
import { getDemoSpeed, isDemoModeEnabled, loadDemoChapters, loadDemoScenarios, type DemoChapter } from "@/lib/txline/demoScenarios";

export const runtime = "nodejs";

export interface DemoStatusResponse {
  active: boolean;
  label: string | null;
  speed: number | null;
  chapters: DemoChapter[];
}

export async function GET() {
  if (!isDemoModeEnabled()) {
    return NextResponse.json<DemoStatusResponse>({ active: false, label: null, speed: null, chapters: [] });
  }

  const [scenario] = loadDemoScenarios();
  return NextResponse.json<DemoStatusResponse>({
    active: true,
    label: scenario?.meta.label ?? null,
    speed: getDemoSpeed(),
    chapters: scenario ? loadDemoChapters(scenario.meta.scenario) : [],
  });
}

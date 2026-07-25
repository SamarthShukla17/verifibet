/**
 * GET /api/demo — whether `DEMO_MODE` is on and, if so, what
 * `components/DemoReplayBanner.tsx`'s persistent pill (and its popover,
 * `components/DemoControlPopover.tsx`) should show for one scenario. A
 * client component can't read the server-only `DEMO_MODE` env var
 * directly (and shouldn't need a `NEXT_PUBLIC_` mirror just for this one
 * boolean — same "server env decides, client asks" shape as
 * `app/api/keeper/status`), so this is the one place that answers it.
 *
 * `?scenario=<name>` selects which registered scenario to describe;
 * omitted defaults to `pickDefaultScenario()` (most-real-first —
 * "recorded beats reconstructed beats synthetic," see
 * `lib/txline/demoScenarios.ts`). The response also lists every
 * registered scenario (`scenarios`) so the popover's picker
 * (Session 7.4) can enumerate options without a second endpoint — every
 * one of them is *already* replaying concurrently server-side
 * (`lib/txline/stream.ts#TxlineStreamManager` runs one `ReplaySource`
 * pair per registered scenario, not just whichever this route happens to
 * describe), so switching the picker is purely "which one is the pill
 * showing/controlling," not "which one starts running." Live playback
 * control (speed/pause/jump) is a separate concern — see
 * `app/api/demo/control/route.ts` — this route is read-only,
 * static-per-scenario status.
 */
import { NextResponse } from "next/server";
import {
  isDemoModeEnabled,
  loadDemoChapterFile,
  findScenarioByName,
  pickDefaultScenario,
  listDemoScenarios,
  type DemoChapter,
  type DemoSource,
  type DemoScenarioSummary,
} from "@/lib/txline/demoScenarios";

export const runtime = "nodejs";

export interface DemoStatusResponse {
  active: boolean;
  scenario: string | null;
  title: string | null;
  label: string | null;
  source: DemoSource | null;
  capturedAt: string | null;
  chapters: DemoChapter[];
  scenarios: DemoScenarioSummary[];
}

export async function GET(req: Request) {
  if (!isDemoModeEnabled()) {
    return NextResponse.json<DemoStatusResponse>({
      active: false,
      scenario: null,
      title: null,
      label: null,
      source: null,
      capturedAt: null,
      chapters: [],
      scenarios: [],
    });
  }

  const requested = new URL(req.url).searchParams.get("scenario");
  const active = requested ? findScenarioByName(requested) : pickDefaultScenario();
  const chapterFile = active ? loadDemoChapterFile(active.meta.scenario) : null;

  return NextResponse.json<DemoStatusResponse>({
    active: true,
    scenario: active?.meta.scenario ?? null,
    title: chapterFile?.title ?? null,
    label: active?.meta.label ?? null,
    source: chapterFile?.source ?? null,
    capturedAt: chapterFile?.capturedAt ?? null,
    chapters: chapterFile?.chapters ?? [],
    scenarios: listDemoScenarios(),
  });
}

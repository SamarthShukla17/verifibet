"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DemoControlPopover } from "@/components/DemoControlPopover";
import { cn } from "@/lib/utils";
import type { DemoStatusResponse } from "@/app/api/demo/route";
import type { DemoControlResponse } from "@/app/api/demo/control/route";
import type { DemoSource } from "@/lib/txline/demoScenarios";

async function fetchStatus(scenario: string | null): Promise<DemoStatusResponse | null> {
  const query = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
  try {
    const res = await fetch(`/api/demo${query}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as DemoStatusResponse;
  } catch {
    return null;
  }
}

async function fetchControl(scenario: string | null): Promise<DemoControlResponse | null> {
  const query = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
  try {
    const res = await fetch(`/api/demo/control${query}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as DemoControlResponse;
  } catch {
    return null;
  }
}

async function postControl(message: unknown): Promise<DemoControlResponse | null> {
  try {
    const res = await fetch("/api/demo/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) return null;
    return (await res.json()) as DemoControlResponse;
  } catch {
    return null;
  }
}

/** Pill copy per source (Session 7.4) — deliberately distinct wording for
 * `"synthetic"`, which isn't TxLINE data at all (fabricated, no real
 * underlying match), unlike `"recorded"`/`"reconstructed"` which both
 * are, just with different degrees of real-vs-synthesized odds. Saying
 * "synthetic TxLINE data" would itself be a small dishonesty this app
 * otherwise goes out of its way to avoid. */
function pillDataLabel(source: DemoSource | null): string {
  switch (source) {
    case "recorded":
      return "recorded TxLINE data";
    case "reconstructed":
      return "reconstructed TxLINE data";
    case "synthetic":
      return "synthetic preview data";
    default:
      return "demo data";
  }
}

const MATCH_PATH_RE = /^\/matches\/(\d+)/;

/**
 * Persistent amber pill, top-right, whenever `DEMO_MODE=1` — mounted once
 * in `app/layout.tsx` so it's genuinely visible in every frame of every
 * page. Honesty is the whole point of this component: it renders nothing
 * at all (not even a hidden placeholder) unless `/api/demo` confirms
 * demo mode is actually on server-side — no client-only "looks right"
 * fallback that could show a false pill, or fail to show a true one. The
 * pill's own text is source-aware (Session 7.4) for the same reason —
 * never says "recorded" for a scenario that isn't.
 *
 * Also owns the live playback controls (Session 7.3) and, since Session
 * 7.4, a scenario picker: every registered scenario replays concurrently
 * server-side regardless of which one this pill happens to be showing
 * (see `lib/txline/stream.ts`'s own doc comment), so "picking" one here
 * is purely about which demo match this pill narrates/controls, not
 * which one is running. Picking one from the popover navigates to that
 * scenario's own `/matches/<demoFixtureId>` page; conversely, landing on
 * a demo match's page any other way (e.g. the Matches list) auto-selects
 * its scenario here too — browsing a demo match *is* picking it. The
 * ⌘/Ctrl+→ "next chapter" shortcut is wired here — not inside the
 * popover — so it keeps working whether or not the popover happens to be
 * open, for narrating one-handed while screen-recording.
 */
export function DemoReplayBanner() {
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] = useState<DemoStatusResponse | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [control, setControl] = useState<DemoControlResponse | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nextChapterIndexRef = useRef(0);

  // Initial load — the default (most-real-first) scenario, plus the full
  // roster every picker option comes from.
  useEffect(() => {
    let cancelled = false;
    fetchStatus(null).then((json) => {
      if (cancelled || !json) return;
      setStatus(json);
      setSelectedScenario((prev) => prev ?? json.scenario);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Landing on a demo match's page by any means (the Matches list, a
  // direct link, back/forward) auto-selects its scenario here too — see
  // this component's own doc comment.
  useEffect(() => {
    if (!status) return;
    const fixtureMatch = pathname.match(MATCH_PATH_RE);
    if (!fixtureMatch) return;
    const fixtureId = Number(fixtureMatch[1]);
    const owner = status.scenarios.find((s) => s.demoFixtureId === fixtureId);
    if (owner && owner.scenario !== selectedScenario) {
      setSelectedScenario(owner.scenario);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, status]);

  // Re-fetch this scenario's own status + control state whenever the
  // selection changes (picker, auto-select-by-URL, or the initial load
  // settling on a default).
  useEffect(() => {
    if (!selectedScenario) return;
    let cancelled = false;
    nextChapterIndexRef.current = 0;
    Promise.all([fetchStatus(selectedScenario), fetchControl(selectedScenario)]).then(
      ([statusJson, controlJson]) => {
        if (cancelled) return;
        if (statusJson) setStatus(statusJson);
        if (controlJson) setControl(controlJson);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedScenario]);

  const selectScenario = useCallback(
    (scenario: string) => {
      setSelectedScenario(scenario);
      const target = status?.scenarios.find((s) => s.scenario === scenario);
      if (target && !pathname.startsWith(`/matches/${target.demoFixtureId}`)) {
        router.push(`/matches/${target.demoFixtureId}`);
      }
    },
    [status, pathname, router],
  );

  const jumpToChapter = useCallback(
    async (index: number) => {
      const chapters = status?.chapters ?? [];
      if (chapters.length === 0 || !selectedScenario) return;
      const clamped = Math.max(0, Math.min(index, chapters.length - 1));
      nextChapterIndexRef.current = Math.min(clamped + 1, chapters.length - 1);

      const result = await postControl({
        type: "jumpTo",
        t: chapters[clamped].t,
        scenario: selectedScenario,
      });
      if (result) setControl(result);
    },
    [status, selectedScenario],
  );

  // Global keyboard shortcut — deliberately attached here, not inside the
  // (possibly closed) popover, so it works the whole time demo mode is
  // active: one hand on the mouse pointing at the match, the other
  // hitting ⌘+→ to advance the narration without breaking eye contact
  // with the screen being recorded.
  useEffect(() => {
    if (!status?.active) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowRight") {
        e.preventDefault();
        void jumpToChapter(nextChapterIndexRef.current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status?.active, jumpToChapter]);

  // Close on outside click / Escape — the popover has no backdrop, so
  // this is what makes it feel like a real popover instead of a panel
  // that's stuck open until the pill is clicked again.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!status?.active || !selectedScenario) return null;

  async function handleSpeedChange(value: number) {
    setControl((c) => (c ? { ...c, speed: value } : c)); // optimistic — the slider must never feel laggy
    const result = await postControl({ type: "speed", value, scenario: selectedScenario });
    if (result) setControl(result);
  }

  async function handleTogglePause() {
    const nextPaused = !(control?.paused ?? false);
    setControl((c) => (c ? { ...c, paused: nextPaused } : c));
    const result = await postControl({
      type: "trigger",
      action: nextPaused ? "pause" : "play",
      scenario: selectedScenario,
    });
    if (result) setControl(result);
  }

  return (
    <div ref={containerRef} className="fixed right-4 top-20 z-[60]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
          "border-accent-gold/40 bg-accent-gold/10 text-accent-gold shadow-lg backdrop-blur",
          "text-xs font-semibold transition-colors hover:bg-accent-gold/20",
        )}
      >
        <span aria-hidden>{control?.paused ? "❚❚" : "▶"}</span>
        <span>
          DEMO REPLAY — {pillDataLabel(status.source)}
          {status.label ? ` (${status.label})` : ""}
          {control?.speed ? ` · ${control.speed}×` : ""}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex justify-end">
          <DemoControlPopover
            scenarios={status.scenarios}
            selectedScenario={selectedScenario}
            onSelectScenario={selectScenario}
            source={status.source}
            chapters={status.chapters}
            speed={control?.speed ?? 60}
            paused={control?.paused ?? false}
            onSpeedChange={(value) => void handleSpeedChange(value)}
            onJumpToChapter={(index) => void jumpToChapter(index)}
            onTogglePause={() => void handleTogglePause()}
          />
        </div>
      )}
    </div>
  );
}

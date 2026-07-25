"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DemoControlPopover } from "@/components/DemoControlPopover";
import { cn } from "@/lib/utils";
import type { DemoStatusResponse } from "@/app/api/demo/route";
import type { DemoControlResponse } from "@/app/api/demo/control/route";

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

/**
 * Persistent amber pill, top-right, whenever `DEMO_MODE=1` — mounted once
 * in `app/layout.tsx` so it's genuinely visible in every frame of every
 * page. Honesty is the whole point of this component: it renders nothing
 * at all (not even a hidden placeholder) unless `/api/demo` confirms
 * demo mode is actually on server-side — no client-only "looks right"
 * fallback that could show a false pill, or fail to show a true one.
 *
 * Also owns the live playback controls (Session 7.3): clicking the pill
 * opens `DemoControlPopover` (speed/chapters/pause), and the ⌘/Ctrl+→
 * "next chapter" shortcut is wired here — not inside the popover — so it
 * keeps working whether or not the popover happens to be open, for
 * narrating one-handed while screen-recording.
 */
export function DemoReplayBanner() {
  const [status, setStatus] = useState<DemoStatusResponse | null>(null);
  const [control, setControl] = useState<DemoControlResponse | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nextChapterIndexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: DemoStatusResponse) => {
        if (!cancelled) setStatus(json);
      })
      .catch(() => {
        // Fails closed — see the doc comment above: no status confirmed
        // means no pill, never a guess.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!status?.active) return;
    let cancelled = false;
    fetch("/api/demo/control", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: DemoControlResponse) => {
        if (!cancelled) setControl(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status?.active]);

  const jumpToChapter = useCallback(
    async (index: number) => {
      const chapters = status?.chapters ?? [];
      if (chapters.length === 0) return;
      const clamped = Math.max(0, Math.min(index, chapters.length - 1));
      nextChapterIndexRef.current = Math.min(clamped + 1, chapters.length - 1);

      const result = await postControl({ type: "jumpTo", t: chapters[clamped].t });
      if (result) setControl(result);
    },
    [status],
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

  if (!status?.active) return null;

  async function handleSpeedChange(value: number) {
    setControl((c) => (c ? { ...c, speed: value } : c)); // optimistic — the slider must never feel laggy
    const result = await postControl({ type: "speed", value });
    if (result) setControl(result);
  }

  async function handleTogglePause() {
    const nextPaused = !(control?.paused ?? false);
    setControl((c) => (c ? { ...c, paused: nextPaused } : c));
    const result = await postControl({ type: "trigger", action: nextPaused ? "pause" : "play" });
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
          DEMO REPLAY — recorded TxLINE data{status.label ? ` (${status.label})` : ""}
          {control?.speed ? ` · ${control.speed}×` : status.speed ? ` · ${status.speed}×` : ""}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex justify-end">
          <DemoControlPopover
            chapters={status.chapters}
            speed={control?.speed ?? status.speed ?? 60}
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

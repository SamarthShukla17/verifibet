"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DemoStatusResponse } from "@/app/api/demo/route";

/**
 * Persistent amber pill, top-right, whenever `DEMO_MODE=1` — mounted once
 * in `app/layout.tsx` so it's genuinely visible in every frame of every
 * page, not something a specific page has to remember to render.
 * Honesty is the whole point of this component: a viewer must never be
 * able to mistake replayed data for a live TxLINE feed, so this renders
 * nothing at all (not even a hidden placeholder) unless `/api/demo`
 * confirms demo mode is actually on server-side — there's no client-only
 * "looks right" fallback that could show a false pill, or fail to show a
 * true one.
 *
 * The label text is entirely server-driven (`/api/demo`, ultimately the
 * active scenario's own `meta.label` — see
 * `scripts/build-demo-scenario.ts`) — this component only ever wraps it
 * in the fixed "▶ DEMO REPLAY — recorded TxLINE data (...) · N×" template,
 * never invents any part of the claim itself.
 */
export function DemoReplayBanner() {
  const [status, setStatus] = useState<DemoStatusResponse | null>(null);

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

  if (!status?.active) return null;

  return (
    <button
      type="button"
      onClick={() =>
        toast("Replay controls aren't wired up yet", {
          description: "Scrubbing/pause/scenario picker land in Session 7.3.",
        })
      }
      className={cn(
        "fixed right-4 top-20 z-[60] inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
        "border-accent-gold/40 bg-accent-gold/10 text-accent-gold shadow-lg backdrop-blur",
        "text-xs font-semibold transition-colors hover:bg-accent-gold/20",
      )}
    >
      <span aria-hidden>▶</span>
      <span>
        DEMO REPLAY — recorded TxLINE data{status.label ? ` (${status.label})` : ""}
        {status.speed ? ` · ${status.speed}×` : ""}
      </span>
    </button>
  );
}

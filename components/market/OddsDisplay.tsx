"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface OddsDisplayProps {
  label: string;
  odds: number;
  impliedPct: number;
  /**
   * Signed change since the last snapshot (e.g. `+0.05`) — shown as a
   * small colored delta next to the odds. Purely a display annotation;
   * the flash animation below is keyed on `odds` itself changing, not on
   * this (so the flash still fires correctly even if a caller doesn't
   * bother computing `delta`).
   */
  delta?: number;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * The most-touched component in the demo — every market screen is
 * mostly a grid of these. Odds are always `.tabular` (mandatory, see
 * app/globals.css) and always the biggest thing in the button; the
 * flash and selected-fill states are the two things a viewer's eye
 * actually needs to catch in real time.
 *
 * The 600ms flash is "keyed on the odds value" literally, not just in
 * spirit: the flash overlay's `key={odds}` forces React to unmount and
 * remount a fresh `<span>` element on every odds change, which restarts
 * its CSS animation cleanly from frame zero every time — no manual
 * animation-restart bookkeeping (`element.offsetHeight` reflow hacks,
 * clearing/reapplying a class in two ticks, ...), the kind of thing that
 * gets subtly wrong under fast-changing values otherwise.
 */
export function OddsDisplay({
  label,
  odds,
  impliedPct,
  delta,
  selected,
  onSelect,
  disabled,
}: OddsDisplayProps) {
  const prevOdds = useRef(odds);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (odds === prevOdds.current) return;
    setFlash(odds > prevOdds.current ? "up" : "down");
    prevOdds.current = odds;

    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [odds]);

  return (
    <button
      type="button"
      onClick={(e) => {
        // Stops this from also triggering a wrapping stretched-link
        // card (see components/market/MatchCard.tsx) — a reusable
        // selector needs this regardless of where it's used, not just
        // in that one composition.
        e.stopPropagation();
        onSelect();
      }}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "group relative flex min-w-0 flex-1 flex-col items-center gap-0.5 overflow-hidden rounded-lg border px-2 py-2.5 text-center transition-colors sm:px-3",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {flash && (
        <span
          key={odds}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0",
            flash === "up" ? "animate-flash-emerald" : "animate-flash-ruby",
          )}
        />
      )}

      <span className="relative truncate text-[11px] font-medium uppercase tracking-wide opacity-70">
        {label}
      </span>

      <span className="relative flex items-baseline gap-1">
        {/* Real decimal odds are always >= 1.0 (you can never get back
            less than your own stake) — 0 is never a genuine quote, so
            it's a safe sentinel for "no data" (a resolved/voided market,
            a fixture with no current odds snapshot) without needing a
            nullable prop type. */}
        <span className="tabular text-2xl font-bold leading-none sm:text-[1.75rem]">
          {odds > 0 ? odds.toFixed(3) : "—"}
        </span>
        {odds > 0 && delta !== undefined && delta !== 0 && (
          <span
            className={cn(
              "tabular text-[10px] font-semibold",
              selected
                ? "text-primary-foreground/80"
                : delta > 0
                  ? "text-primary"
                  : "text-destructive",
            )}
          >
            {delta > 0 ? "▲" : "▼"}
            {Math.abs(delta).toFixed(3)}
          </span>
        )}
      </span>

      <span
        className={cn(
          "relative tabular text-[11px]",
          selected ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        {odds > 0 ? `${impliedPct.toFixed(1)}%` : "no data"}
      </span>
    </button>
  );
}

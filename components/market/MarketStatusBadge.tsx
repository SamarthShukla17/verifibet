"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketStatus } from "@/lib/types";

export interface MarketStatusBadgeProps {
  status: MarketStatus;
  /**
   * The underlying fixture is actually being played right now. Only
   * meaningful when `status === "LOCKED"` (a market locks at/around
   * kickoff and stays locked through the whole match, so "locked" alone
   * doesn't tell a bettor whether the game is currently live or just
   * hasn't been resolved yet) — renders the pulsing LIVE state with the
   * minute instead of a generic "Locked" label.
   */
  isLive?: boolean;
  /** Current match minute, shown next to the LIVE dot when known. */
  liveMinute?: number;
  className?: string;
}

export function MarketStatusBadge({
  status,
  isLive,
  liveMinute,
  className,
}: MarketStatusBadgeProps) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (status === "RESOLVED") {
    return (
      <span
        className={cn(
          base,
          "border-accent-gold/40 bg-accent-gold/10 text-accent-gold",
          className,
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
        Resolved
      </span>
    );
  }

  if (status === "VOIDED") {
    return (
      <span
        className={cn(
          base,
          "border-border text-muted-foreground line-through decoration-2",
          className,
        )}
      >
        Voided
      </span>
    );
  }

  if (status === "LOCKED" && isLive) {
    return (
      <span
        className={cn(
          base,
          "border-destructive/40 bg-destructive/10 text-destructive",
          className,
        )}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
        </span>
        <span className="tabular">LIVE{liveMinute != null ? ` ${liveMinute}'` : ""}</span>
      </span>
    );
  }

  if (status === "LOCKED") {
    return (
      <span
        className={cn(base, "border-border bg-muted text-muted-foreground", className)}
      >
        Locked
      </span>
    );
  }

  // OPEN — emerald outline, no fill.
  return (
    <span className={cn(base, "border-primary/50 text-primary", className)}>
      Open
    </span>
  );
}

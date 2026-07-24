"use client";

import { useEffect, useState } from "react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { formatUsdc } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { Outcome } from "@/lib/types";

interface BetActivity {
  signature: string;
  explorerUrl: string;
  blockTime: number | null;
  user: string;
  outcome: Outcome;
  amount: string;
}

function outcomeLabel(outcome: Outcome, home: string, away: string): string {
  return outcome === 0 ? home : outcome === 1 ? "Draw" : away;
}

function relativeTime(blockTime: number | null): string {
  if (blockTime === null) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - blockTime);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface ActivityTabProps {
  fixtureId: number;
  home: string;
  away: string;
}

/** Recent `BetPlaced` events for this fixture's market — fetched once
 * (not polled; a bet-history feed doesn't need 15s freshness the way a
 * live pool total does) from app/api/markets/[fixtureId]/activity, which
 * does the real `getSignaturesForAddress` + event-log parsing work
 * server-side (see lib/solana/activity.ts). */
export function ActivityTab({ fixtureId, home, away }: ActivityTabProps) {
  const [activity, setActivity] = useState<BetActivity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/markets/${fixtureId}/activity`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { activity?: BetActivity[] }) => {
        // A non-200 response (RPC hiccup, rate limit) parses fine as
        // JSON but has no `activity` field — treated the same as "no
        // activity yet" rather than crashing on `.length` of `undefined`.
        if (!cancelled) setActivity(Array.isArray(json.activity) ? json.activity : []);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureId]);

  if (activity === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
        No bets placed yet — be the first.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {/* A plain row, not an outer `<a>` — the bettor's own address is
          now its own `ExplorerLink`, and anchors can't nest, so the
          transaction gets its own explicit link too instead of being
          implied by wrapping the whole row. */}
      {activity.map((bet) => (
        <div
          key={bet.signature}
          className="flex items-center justify-between gap-3 p-3 text-sm transition-colors hover:bg-accent"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              <ExplorerLink kind="account" value={bet.user} className="text-foreground hover:text-primary" /> backed{" "}
              <span className="text-primary">{outcomeLabel(bet.outcome, home, away)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{relativeTime(bet.blockTime)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="tabular font-semibold text-foreground">
              {formatUsdc(BigInt(bet.amount), 2)} USDC
            </span>
            <ExplorerLink kind="tx" value={bet.signature} display="Tx" />
          </div>
        </div>
      ))}
    </div>
  );
}

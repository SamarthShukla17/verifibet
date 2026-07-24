"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { formatUsdc } from "@/lib/format";
import { useMyBets } from "@/lib/hooks/useMyBets";
import { cn } from "@/lib/utils";

export interface PersonalPositionStripProps {
  fixtureId: number;
}

/**
 * "You had a position on this match" — only ever renders something for
 * the wallet actually connected in *this* browser; a judge or anyone
 * else loading this same public URL with no wallet connected (or a
 * different one with no position here) sees nothing at all, not an
 * empty placeholder. Reuses `useMyBets` wholesale rather than a bespoke
 * fetch — that hook already joins every one of the connected wallet's
 * `Bet`s against their `Market`s and classifies them; this just picks
 * out the one (if any) matching this page's own `fixtureId`.
 *
 * Colored by the position's real outcome, not always emerald — a
 * receipt that only ever flattered wins wouldn't be an honest receipt.
 */
export function PersonalPositionStrip({ fixtureId }: PersonalPositionStripProps) {
  const { connected } = useWallet();
  const { positions } = useMyBets();

  if (!connected || !positions) return null;
  const mine = positions.find((p) => p.fixtureId === fixtureId);
  if (!mine) return null;

  const isWin = mine.status === "won" || (mine.status === "claimed" && mine.payout !== null && mine.payout >= mine.amount);
  const amountClassName =
    mine.status === "lost" ? "text-muted-foreground" : isWin ? "text-primary" : "text-foreground";

  const resultLabel =
    mine.status === "lost"
      ? "Lost"
      : mine.status === "refundable"
        ? "Refund available"
        : mine.status === "claimed"
          ? "Claimed"
          : "Won";

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your position</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">
          {formatUsdc(mine.amount)} USDC on {mine.pickLabel}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className={cn("font-bold", amountClassName)}>
          {mine.payout !== null ? `${formatUsdc(mine.payout)} USDC` : "—"}
        </span>
        <span className={cn("rounded-full border border-border px-2 py-0.5 text-xs font-medium", amountClassName)}>
          {resultLabel}
        </span>
      </div>
    </div>
  );
}

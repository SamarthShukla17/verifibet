"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useBalances } from "@/lib/hooks/useBalances";
import { formatUsdc } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

/** "3.2", not "3.20" or "3.199999996" — SOL is gas-money context here,
 * not a bigint settlement amount, so a plain rounded display (2dp, no
 * padded trailing zeros) is honest enough without needing lib/format.ts's
 * precision machinery (that file is scoped to the bigint USDC convention
 * specifically — see its own header comment). */
function formatSol(sol: number): string {
  return (Math.round(sol * 100) / 100).toString();
}

/** SOL + USDC balance chip, hidden entirely when no wallet is connected
 * (nothing to show) and below `sm` (navbar real estate is tight enough
 * there without it — see app-shell's own 360px zero-overflow bar). */
export function BalanceChip() {
  const { connected } = useWallet();
  const { sol, usdc, loading } = useBalances();

  if (!connected) return null;

  if (loading) {
    return (
      <div className="hidden items-center rounded-md border border-border bg-card px-3 py-1.5 sm:flex">
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }

  return (
    <div className="tabular hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground sm:flex">
      <span aria-label={`${formatSol(sol)} SOL`}>◎ {formatSol(sol)}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span aria-label={`${formatUsdc(usdc)} USDC`}>💵 {formatUsdc(usdc)} USDC</span>
    </div>
  );
}

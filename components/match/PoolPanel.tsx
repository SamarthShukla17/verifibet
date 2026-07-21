"use client";

import { formatUsdc } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketAccountResponse } from "@/lib/hooks/useMarketAccount";

export interface PoolPanelProps {
  home: string;
  away: string;
  market: MarketAccountResponse | null;
  loading: boolean;
}

function poolPercent(pool: bigint, total: bigint): number {
  if (total === 0n) return 0;
  // Integer math (bigint) up to a hundredth of a percent, then to float
  // only for display — avoids floating-point drift on real, large pools.
  return Number((pool * 10_000n) / total) / 100;
}

/**
 * Per-outcome pooled USDC, read straight from the on-chain `Market`
 * account (`useMarketAccount`, polled every 15s — see that hook). Two
 * honest non-happy-path states, both real and expected for this demo's
 * compressed fixture calendar (see scripts/sync-markets.ts / NOTES.md):
 * `loading` (first poll hasn't landed) and `!market.synced` (no `Market`
 * account exists on-chain yet for this fixture at all) — neither is
 * treated as an error.
 */
export function PoolPanel({ home, away, market, loading }: PoolPanelProps) {
  if (loading && !market) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="mb-3 h-4 w-16" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (!market?.synced) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-center text-sm text-muted-foreground">
        Market not yet on-chain for this fixture.
      </div>
    );
  }

  const pools = market.pools!.map((p) => BigInt(p)) as [bigint, bigint, bigint];
  const total = BigInt(market.totalPool ?? "0");
  const rows: { label: string; value: bigint }[] = [
    { label: home, value: pools[0] },
    { label: "Draw", value: pools[1] },
    { label: away, value: pools[2] },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pool</p>
        <span className="tabular text-xs text-muted-foreground">
          {market.bettorCount ?? 0} bettor{market.bettorCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const pct = poolPercent(row.value, total);
          return (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground">{row.label}</span>
                <span className="tabular shrink-0 text-muted-foreground">
                  {formatUsdc(row.value, 0)} · {pct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="font-semibold text-foreground">Total pooled</span>
        <span className="tabular font-bold text-foreground">{formatUsdc(total, 2)} USDC</span>
      </div>
    </div>
  );
}

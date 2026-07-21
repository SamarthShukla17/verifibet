"use client";

import { useEffect, useState } from "react";

export interface MarketAccountResponse {
  synced: boolean;
  fixtureId?: number;
  status?: "open" | "locked" | "resolved" | "voided";
  outcome?: number | null;
  /** USDC base units per outcome, decimal strings — see
   * lib/solana/market.ts's `MarketAccountData.pools` doc comment for why
   * (u64 can exceed `Number.MAX_SAFE_INTEGER`). Parse with `BigInt(...)`. */
  pools?: [string, string, string];
  totalPool?: string;
  resolvedAt?: number;
  bettorCount?: number;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Polls `/api/markets/:fixtureId` every 15s — the on-chain `Market`
 * account's pools/status/bettor-count for the pool panel and BetSlip's
 * payout estimate. A failed poll (RPC hiccup, rate limit) keeps the last
 * good value on screen rather than clearing it to a loading/error state —
 * a stale-but-real number beats a blank one for something that only
 * changes when someone places a bet.
 */
export function useMarketAccount(fixtureId: number) {
  const [data, setData] = useState<MarketAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/markets/${fixtureId}`, { cache: "no-store" });
        const json: MarketAccountResponse = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // keep last-known-good value — see doc comment above
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fixtureId]);

  return { market: data, loading };
}

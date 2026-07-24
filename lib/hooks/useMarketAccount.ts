"use client";

import { useCallback, useEffect, useState } from "react";
import type { Outcome } from "@/lib/types";

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
  /** Base58 — see lib/solana/market.ts's `MarketAccountData.usdcMint` doc
   * comment. Needed by BetSlip to build a real `place_bet` transaction. */
  usdcMint?: string;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Polls `/api/markets/:fixtureId` every 15s — the on-chain `Market`
 * account's pools/status/bettor-count for the pool panel and BetSlip's
 * payout estimate. A failed poll (RPC hiccup, rate limit) keeps the last
 * good value on screen rather than clearing it to a loading/error state —
 * a stale-but-real number beats a blank one for something that only
 * changes when someone places a bet.
 *
 * `fixtureId <= 0` skips fetching entirely (`synced: false`, no request
 * ever made) rather than hitting `/api/markets/0` and getting back a 400 —
 * a real, deliberate call shape for a page like MatchesBoard.tsx that
 * calls this hook unconditionally (React's rules of hooks) even before
 * the viewer has picked a fixture to bet on yet.
 */
export function useMarketAccount(fixtureId: number) {
  const [data, setData] = useState<MarketAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const poll = useCallback(async () => {
    if (fixtureId <= 0) {
      setData({ synced: false });
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/markets/${fixtureId}`, { cache: "no-store" });
      const json: MarketAccountResponse = await res.json();
      setData(json);
    } catch {
      // keep last-known-good value — see doc comment above
    } finally {
      setLoading(false);
    }
  }, [fixtureId]);

  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      if (cancelled) return;
      await poll();
    }

    void pollOnce();
    if (fixtureId <= 0) return;
    const interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [poll, fixtureId]);

  // Local-only, no network — bumps `pools[outcome]`/`totalPool` by
  // `amountBaseUnits` immediately after `sendAndConfirm` resolves, so the
  // pool panel reflects a just-placed bet the instant the signature
  // confirms rather than waiting on `refresh`'s own RPC round trip.
  // Purely optimistic: the very next `refresh()` (usePlaceBet always calls
  // one right after) overwrites this with the real on-chain value, so a
  // stale/incorrect bump here can't linger.
  const applyOptimisticBump = useCallback((outcome: Outcome, amountBaseUnits: bigint) => {
    setData((prev) => {
      if (!prev?.synced || !prev.pools || !prev.totalPool) return prev;
      const pools = [...prev.pools] as [string, string, string];
      pools[outcome] = (BigInt(pools[outcome]) + amountBaseUnits).toString();
      const totalPool = (BigInt(prev.totalPool) + amountBaseUnits).toString();
      return { ...prev, pools, totalPool };
    });
  }, []);

  // Exposed so a just-confirmed `place_bet` can refresh the pool panel
  // immediately rather than waiting up to POLL_INTERVAL_MS for the next
  // scheduled tick — the on-chain data is already there the moment
  // `sendAndConfirm` resolves, no reason to make the UI look stale for up
  // to 15s after a bet a viewer just watched land.
  return { market: data, loading, refresh: poll, applyOptimisticBump };
}

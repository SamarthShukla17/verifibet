"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketPoolSummary } from "@/lib/solana/market";

const POLL_INTERVAL_MS = 15_000;

/**
 * Polls `/api/markets` every 15s (same cadence as `useMarketAccount`) and
 * returns every synced market's total pool as `fixtureId -> USDC base
 * units`. Backs the matches list's per-card pool footer — before this,
 * every `MatchCard`/`LiveMatchCard` on `/matches` hardcoded
 * `totalPoolBaseUnits={0n}` (a deliberate simplification to avoid one
 * on-chain read per card) and only the currently bet-slip-selected
 * fixture ever saw its real pool, via `useMarketAccount`. A missing entry
 * (fixture has no on-chain market yet) reads as `0n` here too, same
 * "honestly zero, not an error" convention as everywhere else pools are
 * shown.
 */
export function useMarketPools() {
  const [pools, setPools] = useState<Map<number, bigint>>(new Map());

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const json: MarketPoolSummary[] = await res.json();
      setPools(new Map(json.map((m) => [m.fixtureId, BigInt(m.totalPool)])));
    } catch {
      // keep last-known-good value — same convention as useMarketAccount
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollOnce() {
      if (cancelled) return;
      await poll();
    }
    void pollOnce();
    const interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [poll]);

  return pools;
}

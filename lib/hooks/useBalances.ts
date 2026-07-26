"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { CIRCLE_DEVNET_USDC_MINT } from "@/lib/config";

const LAMPORTS_PER_SOL = 1_000_000_000;

export interface UseBalancesResult {
  /** Lamports / 1e9, a plain `number` — SOL here is gas-money context,
   * not a settlement amount the program tracks, so it falls outside
   * CLAUDE.md's bigint-money convention the same way TxLINE odds/implied
   * percentages do (display data, not money the app moves). */
  sol: number;
  /** USDC base units, 6dp, bigint — CIRCLE_DEVNET_USDC_MINT specifically
   * (see lib/config.ts's doc comment), not CONFIG.devnet.usdcMint. `0n`
   * when the ATA doesn't exist yet — a real, normal "no USDC yet" state,
   * not an error. */
  usdc: bigint;
  loading: boolean;
  refresh: () => void;
}

/** `0n` on a missing ATA specifically (checked via `getAccountInfo`
 * returning `null`, not by pattern-matching an RPC error message) —
 * same two-step shape as WalletUx.tsx's own `hasZeroOrMissingUsdc`. */
async function fetchUsdcBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  const accountInfo = await connection.getAccountInfo(ata);
  if (!accountInfo) return 0n;
  const balance = await connection.getTokenAccountBalance(ata);
  return BigInt(balance.value.amount);
}

/**
 * SOL + USDC balances for the connected wallet, kept live via
 * `connection.onAccountChange` on both the wallet account (SOL) and its
 * USDC ATA — a bet landing, a faucet mint arriving, or a claim paying out
 * all update the navbar chip without polling. `loading` is `true` only
 * until the *first* fetch settles (or immediately, if no wallet is
 * connected) — a live-refresh triggered by an on-chain change updates the
 * numbers in place rather than flashing the skeleton again.
 *
 * SOL and USDC are fetched independently (not one `Promise.all` that
 * fails atomically): an RPC hiccup on one keeps the other's last-known-
 * good value on screen instead of blanking both — same "stale beats
 * blank" philosophy as `useMarketAccount.ts`.
 *
 * `usdcMintOverride` (Session 7 exit): defaults to `CIRCLE_DEVNET_USDC_MINT`,
 * correct for the navbar chip's "how much can this wallet fund a *new*
 * bet with" question — but a specific market's own `usdc_mint` can be
 * (and, for every market created since the mock-mint pivot documented in
 * `lib/config.ts`'s own doc comment, *is*) a different mint entirely.
 * `usePlaceBet.ts` passes the current market's own `usdcMint` here so a
 * bet slip's balance/affordability check matches the mint `place_bet`
 * actually spends from, not a hardcoded, now-stale assumption — found
 * live this session: the presenter wallet had 10,493 mock-mint USDC and
 * the bet slip still showed a 20 USDC Circle-mint balance with "not
 * enough" on a 25 USDC bet.
 */
export function useBalances(usdcMintOverride?: string): UseBalancesResult {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState(0);
  const [usdc, setUsdc] = useState(0n);
  const [loading, setLoading] = useState(true);
  const mint = usdcMintOverride ?? CIRCLE_DEVNET_USDC_MINT;

  // Guards against a stale in-flight fetch (e.g. for a wallet that was
  // just disconnected, or a mint that changed mid-flight) overwriting
  // state after a newer one already resolved.
  const requestId = useRef(0);
  const hasLoadedOnce = useRef(false);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) {
      setSol(0);
      setUsdc(0n);
      setLoading(false);
      hasLoadedOnce.current = true;
      return;
    }

    const thisRequest = ++requestId.current;
    if (!hasLoadedOnce.current) setLoading(true);

    // Dynamically imported (not a static top-level import) — see
    // lib/solana/program.ts's own doc comment on why: `@solana/spl-token`
    // is ~65KB gzipped, and this hook is reachable from `/matches`'s
    // always-rendered `BetSlip`/navbar balance chip.
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey);

    const [lamports, usdcAmount] = await Promise.all([
      connection.getBalance(publicKey).catch(() => null),
      fetchUsdcBalance(connection, ata).catch(() => null),
    ]);

    if (thisRequest !== requestId.current) return; // superseded by a newer request

    if (lamports !== null) setSol(lamports / LAMPORTS_PER_SOL);
    if (usdcAmount !== null) setUsdc(usdcAmount);
    setLoading(false);
    hasLoadedOnce.current = true;
  }, [connection, publicKey, mint]);

  useEffect(() => {
    hasLoadedOnce.current = false;
    void fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    let solSub: number | null = null;
    let usdcSub: number | null = null;

    void (async () => {
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      if (cancelled) return;
      const ata = getAssociatedTokenAddressSync(new PublicKey(mint), publicKey);
      solSub = connection.onAccountChange(publicKey, () => void fetchBalances());
      usdcSub = connection.onAccountChange(ata, () => void fetchBalances());
    })();

    return () => {
      cancelled = true;
      if (solSub !== null) void connection.removeAccountChangeListener(solSub);
      if (usdcSub !== null) void connection.removeAccountChangeListener(usdcSub);
    };
  }, [connection, publicKey, fetchBalances, mint]);

  return { sol, usdc, loading, refresh: fetchBalances };
}

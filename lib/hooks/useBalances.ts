"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
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
 */
export function useBalances(): UseBalancesResult {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState(0);
  const [usdc, setUsdc] = useState(0n);
  const [loading, setLoading] = useState(true);

  // Guards against a stale in-flight fetch (e.g. for a wallet that was
  // just disconnected) overwriting state after a newer one already
  // resolved.
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

    const ata = getAssociatedTokenAddressSync(new PublicKey(CIRCLE_DEVNET_USDC_MINT), publicKey);

    const [lamports, usdcAmount] = await Promise.all([
      connection.getBalance(publicKey).catch(() => null),
      fetchUsdcBalance(connection, ata).catch(() => null),
    ]);

    if (thisRequest !== requestId.current) return; // superseded by a newer request

    if (lamports !== null) setSol(lamports / LAMPORTS_PER_SOL);
    if (usdcAmount !== null) setUsdc(usdcAmount);
    setLoading(false);
    hasLoadedOnce.current = true;
  }, [connection, publicKey]);

  useEffect(() => {
    hasLoadedOnce.current = false;
    void fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    if (!publicKey) return;

    const ata = getAssociatedTokenAddressSync(new PublicKey(CIRCLE_DEVNET_USDC_MINT), publicKey);
    const solSub = connection.onAccountChange(publicKey, () => void fetchBalances());
    const usdcSub = connection.onAccountChange(ata, () => void fetchBalances());

    return () => {
      void connection.removeAccountChangeListener(solSub);
      void connection.removeAccountChangeListener(usdcSub);
    };
  }, [connection, publicKey, fetchBalances]);

  return { sol, usdc, loading, refresh: fetchBalances };
}

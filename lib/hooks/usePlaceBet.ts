"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useBalances } from "@/lib/hooks/useBalances";
import type { MarketAccountResponse } from "@/lib/hooks/useMarketAccount";
import { parseUsdc } from "@/lib/format";
import { getProgram } from "@/lib/solana/program";
import { buildPlaceBetTx } from "@/lib/solana/placeBet";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import type { Outcome } from "@/lib/types";

export interface UsePlaceBetResult {
  /** USDC base units, 6dp — the connected wallet's live balance. */
  balance: bigint;
  balanceLoading: boolean;
  /** Builds + sends the real `place_bet` transaction for `fixtureId` and
   * resolves with its signature — the one place both BetSlip call sites
   * (MatchDetailBoard, MatchesBoard) get this from, so the account-
   * building logic can't drift between them. */
  placeBet: (fixtureId: number, outcome: Outcome, amountInput: string) => Promise<string>;
}

/**
 * Shared wallet + on-chain wiring behind every BetSlip's `onSubmit` —
 * extracted once a second real call site (MatchesBoard.tsx's list-page
 * slip) needed the identical connection/wallet/balance/`getProgram`/
 * `buildPlaceBetTx`/`sendAndConfirm` sequence MatchDetailBoard.tsx already
 * had, rather than let a copy-pasted second version quietly diverge from
 * the first.
 */
export function usePlaceBet(
  market: MarketAccountResponse | null,
  onSettled?: () => void,
): UsePlaceBetResult {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { usdc: balance, loading: balanceLoading, refresh: refreshBalance } = useBalances();

  const placeBet = useCallback(
    async (fixtureId: number, outcome: Outcome, amountInput: string) => {
      if (!wallet.publicKey) throw new Error("wallet not connected");
      if (!market?.synced || !market.usdcMint) throw new Error("market not synced on-chain yet");

      const amountBaseUnits = parseUsdc(amountInput);
      if (amountBaseUnits === null || amountBaseUnits <= 0n) throw new Error("invalid bet amount");

      const program = getProgram(connection, wallet.publicKey);
      const tx = await buildPlaceBetTx(program, {
        fixtureId,
        user: wallet.publicKey,
        outcome,
        amount: amountBaseUnits,
        usdcMint: new PublicKey(market.usdcMint),
      });

      const signature = await sendAndConfirm(connection, wallet, tx, { label: "Placing bet" });
      void refreshBalance();
      onSettled?.();
      return signature;
    },
    [connection, wallet, market, refreshBalance, onSettled],
  );

  return { balance, balanceLoading, placeBet };
}

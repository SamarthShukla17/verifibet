"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useBalances } from "@/lib/hooks/useBalances";
import type { MarketAccountResponse } from "@/lib/hooks/useMarketAccount";
import { parseUsdc } from "@/lib/format";
import { getProgram, placeBet as placeBetTx } from "@/lib/solana/program";
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
 * `placeBet`/`sendAndConfirm` sequence MatchDetailBoard.tsx already had,
 * rather than let a copy-pasted second version quietly diverge from the
 * first.
 *
 * The onConfirm sequence, in order: build the tx (`program.ts#placeBet`,
 * which reads the market's real `usdc_mint` on-chain itself) -> send +
 * confirm it for real (`sendAndConfirm`) -> bump the pool optimistically
 * so the UI reflects the bet the instant it confirms, not 15s later ->
 * refresh both the market account and the wallet balance for real,
 * correcting the optimistic guess with the actual on-chain state.
 */
export function usePlaceBet(
  market: MarketAccountResponse | null,
  applyOptimisticBump?: (outcome: Outcome, amountBaseUnits: bigint) => void,
  onSettled?: () => void,
): UsePlaceBetResult {
  const { connection } = useConnection();
  const wallet = useWallet();
  // The market's own usdc_mint, not a hardcoded assumption — see
  // useBalances.ts's own doc comment on why that matters now that not
  // every market shares the same mint.
  const { usdc: balance, loading: balanceLoading, refresh: refreshBalance } = useBalances(market?.usdcMint);

  const placeBet = useCallback(
    async (fixtureId: number, outcome: Outcome, amountInput: string) => {
      if (!wallet.publicKey) throw new Error("wallet not connected");
      if (!market?.synced) throw new Error("market not synced on-chain yet");

      const amountBaseUnits = parseUsdc(amountInput);
      if (amountBaseUnits === null || amountBaseUnits <= 0n) throw new Error("invalid bet amount");

      const program = await getProgram(connection, wallet);
      const tx = await placeBetTx(program, {
        fixtureId: BigInt(fixtureId),
        outcome,
        amountBaseUnits,
      });

      const signature = await sendAndConfirm(connection, wallet, tx, { label: "Placing bet" });

      applyOptimisticBump?.(outcome, amountBaseUnits);
      void refreshBalance();
      onSettled?.();
      return signature;
    },
    [connection, wallet, market, applyOptimisticBump, refreshBalance, onSettled],
  );

  return { balance, balanceLoading, placeBet };
}

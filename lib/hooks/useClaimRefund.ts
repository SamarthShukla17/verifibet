"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { claimRefund as claimRefundTx, getProgram } from "@/lib/solana/program";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import type { Outcome } from "@/lib/types";

export interface UseClaimRefundResult {
  /** Builds + sends the real `claim_refund` transaction for one voided
   * position and resolves with its signature — same
   * build-tx/send-and-confirm/refresh shape as `usePlaceBet`'s
   * `placeBet`, applied to the refund side instead of the bet side. */
  claimRefund: (fixtureId: number, outcome: Outcome) => Promise<string>;
}

/**
 * Wallet + on-chain wiring behind `PositionRow`'s REFUND button — kept as
 * its own small hook (not folded into `usePlaceBet`) since it needs none
 * of that hook's balance-tracking or optimistic-pool-bump machinery, just
 * connection/wallet plus a settled-callback to re-fetch positions once
 * the refund lands.
 */
export function useClaimRefund(onSettled?: () => void): UseClaimRefundResult {
  const { connection } = useConnection();
  const wallet = useWallet();

  const claimRefund = useCallback(
    async (fixtureId: number, outcome: Outcome) => {
      if (!wallet.publicKey) throw new Error("wallet not connected");

      const program = await getProgram(connection, wallet);
      const tx = await claimRefundTx(program, { fixtureId: BigInt(fixtureId), outcome });

      const signature = await sendAndConfirm(connection, wallet, tx, { label: "Claiming refund" });

      onSettled?.();
      return signature;
    },
    [connection, wallet, onSettled],
  );

  return { claimRefund };
}

"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { claimWinnings as claimWinningsTx, getProgram } from "@/lib/solana/program";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import type { Outcome } from "@/lib/types";

export interface UseClaimWinningsResult {
  /** Builds + sends the real `claim_winnings` transaction for one won
   * position and resolves with its signature — same
   * build-tx/send-and-confirm/refresh shape as `useClaimRefund`'s
   * `claimRefund`, applied to the winnings side instead of the refund
   * side (see `lib/solana/program.ts#claimWinnings`'s own doc comment —
   * this hook is what actually wires it into the UI; until now only
   * `scripts/seed-demo.ts`/`scripts/demoRig.ts` called it directly).
   */
  claimWinnings: (fixtureId: number, outcome: Outcome) => Promise<string>;
}

export function useClaimWinnings(onSettled?: () => void): UseClaimWinningsResult {
  const { connection } = useConnection();
  const wallet = useWallet();

  const claimWinnings = useCallback(
    async (fixtureId: number, outcome: Outcome) => {
      if (!wallet.publicKey) throw new Error("wallet not connected");

      const program = await getProgram(connection, wallet);
      const tx = await claimWinningsTx(program, { fixtureId: BigInt(fixtureId), outcome });

      const signature = await sendAndConfirm(connection, wallet, tx, { label: "Claiming winnings" });

      onSettled?.();
      return signature;
    },
    [connection, wallet, onSettled],
  );

  return { claimWinnings };
}

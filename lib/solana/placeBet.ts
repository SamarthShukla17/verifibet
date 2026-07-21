/**
 * Builds a `place_bet` `Transaction` — every account explicit (never
 * relying on Anchor's own PDA auto-resolution for `vault`, even though
 * the IDL carries enough seed info for it to in principle derive that
 * one itself): CLAUDE.md documents three separate real Anchor 0.30.1
 * codegen bugs already hit in this exact program, so nothing here trusts
 * Anchor to get an address right that this module can just as easily
 * compute itself via the same helpers `anchor/tests/verifibet.ts` uses
 * (`marketPda`/`betPda` from `lib/solana/pda.ts`, `getAssociatedTokenAddressSync`
 * for both ATAs). Building the instruction is the only thing this module
 * does — sending it is `sendAndConfirm`'s job (lib/solana/sendTx.ts), not
 * this one's.
 */
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN, type Program } from "@coral-xyz/anchor";
import { betPda, marketPda } from "@/lib/solana/pda";
import type { Outcome } from "@/lib/types";

export interface PlaceBetParams {
  fixtureId: number;
  user: PublicKey;
  outcome: Outcome;
  /** USDC base units, 6dp. */
  amount: bigint;
  /** The market's own `usdc_mint` field (see `MarketAccountData.usdcMint`'s
   * doc comment) — not assumed to be any particular constant. */
  usdcMint: PublicKey;
}

export async function buildPlaceBetTx(program: Program, params: PlaceBetParams): Promise<Transaction> {
  const { fixtureId, user, outcome, amount, usdcMint } = params;

  const [market] = marketPda(program.programId, fixtureId);
  const [bet] = betPda(program.programId, market, user, outcome);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  // `allowOwnerOffCurve: true` — the vault's "owner" is the market PDA,
  // which by construction never sits on the ed25519 curve.
  const vault = getAssociatedTokenAddressSync(usdcMint, market, true);

  const ix = await program.methods
    .placeBet(outcome, new BN(amount.toString()))
    .accounts({
      user,
      market,
      bet,
      userUsdc,
      usdcMint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .instruction();

  return new Transaction().add(ix);
}

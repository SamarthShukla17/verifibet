/**
 * PDA derivation — the single TS-side source of truth (see CLAUDE.md:
 * "PDAs are derived in exactly one place per language"). Mirrors
 * `anchor/programs/verifibet/src/state.rs`'s `#[account(seeds = ...)]`
 * constraints exactly; don't re-derive these seeds inline elsewhere.
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const MARKET_SEED = Buffer.from("market");
const BET_SEED = Buffer.from("bet");

/** `[MARKET_SEED, fixture_id.to_le_bytes()]` — one Market per TxLINE fixture. */
export function marketPda(
  programId: PublicKey,
  fixtureId: number | bigint | BN,
): [PublicKey, number] {
  const bn = BN.isBN(fixtureId) ? fixtureId : new BN(fixtureId.toString());
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, bn.toArrayLike(Buffer, "le", 8)],
    programId,
  );
}

/**
 * `[BET_SEED, market, user, [outcome]]` — one position per (user, outcome)
 * pair per market; re-betting the same outcome reuses this same PDA.
 */
export function betPda(
  programId: PublicKey,
  market: PublicKey,
  user: PublicKey,
  outcome: 0 | 1 | 2,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BET_SEED, market.toBuffer(), user.toBuffer(), Buffer.from([outcome])],
    programId,
  );
}

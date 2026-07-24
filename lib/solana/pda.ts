/**
 * PDA derivation — the ONLY place these seeds exist in TS (see CLAUDE.md:
 * "PDAs are derived in exactly one place per language"). Mirrors
 * `anchor/programs/verifibet/src/state.rs`'s `#[account(seeds = ...)]`
 * constraints byte-for-byte; don't re-derive these seeds inline anywhere
 * else — every call site imports `deriveMarket`/`deriveBet`/`deriveVault`
 * from here.
 *
 * `PROGRAM_ID` lives here (not in `program.ts`) so this module has no
 * dependency on `@coral-xyz/anchor`/the IDL/`AnchorProvider` at all — just
 * `@solana/web3.js` — and `program.ts` imports it back from here instead
 * of the two modules each keeping their own copy.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Outcome } from "@/lib/types";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
);

const MARKET_SEED = Buffer.from("market");
const BET_SEED = Buffer.from("bet");

/** `fixture_id.to_le_bytes()` on the Rust side is a plain 8-byte
 * little-endian `u64` — `Buffer.writeBigUInt64LE` produces the exact same
 * bytes directly from a `bigint`, no `BN` round-trip needed. */
function u64LeBytes(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/** `[MARKET_SEED, fixture_id.to_le_bytes()]` — one Market per TxLINE fixture. */
export function deriveMarket(fixtureId: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MARKET_SEED, u64LeBytes(fixtureId)], PROGRAM_ID);
}

/**
 * `[BET_SEED, market, user, [outcome]]` — one position per (user, outcome)
 * pair per market; re-betting the same outcome reuses this same PDA.
 */
export function deriveBet(market: PublicKey, user: PublicKey, outcome: Outcome): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BET_SEED, market.toBuffer(), user.toBuffer(), Buffer.from([outcome])],
    PROGRAM_ID,
  );
}

/**
 * Not a custom PDA seed — the market's vault is always the canonical
 * associated token account of `market` for `usdcMint` (see
 * `initialize_market`'s own doc comment in `instructions/mod.rs`).
 * `allowOwnerOffCurve: true` because the "owner" here is `market`, a PDA,
 * which by construction never sits on the ed25519 curve. Still centralized
 * here rather than inlined at each call site, same as the two derivations
 * above — one place, not three copies that could drift.
 */
export function deriveVault(usdcMint: PublicKey, market: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint, market, true);
}

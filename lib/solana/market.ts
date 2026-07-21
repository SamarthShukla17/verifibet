/**
 * Read-only on-chain reads for one fixture's `Market` — pools/status for
 * the pool panel, and a distinct-bettor count derived from `Bet` accounts
 * (the `Market` account itself has no bettor-count field; a bettor with
 * positions on two different outcomes owns two `Bet` PDAs, so this counts
 * distinct `user` pubkeys, not `Bet` accounts, to avoid double-counting
 * them). Server-only by the same convention as the rest of `lib/`.
 */
import { PublicKey } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";
import { marketPda } from "@/lib/solana/pda";
import { getReadOnlyProgram, MARKET_ACCOUNT_IDL_NAME } from "@/lib/solana/program";
import type { MarketStatus, Outcome } from "@/lib/types";

/** `Bet`'s on-chain layout (see anchor/programs/verifibet/src/state.rs):
 * 8-byte discriminator, then `user: Pubkey` (32), then `market: Pubkey`
 * (32) — used to slice out just the `user` field from every `Bet` for a
 * given market without decoding the whole account. */
const BET_USER_OFFSET = 8;
const BET_MARKET_OFFSET = 8 + 32;

export interface MarketAccountData {
  fixtureId: number;
  status: Lowercase<MarketStatus>;
  outcome: Outcome | null;
  /** Base58 — the mint `place_bet` must pass as its own `usdc_mint`
   * account (re-checked on-chain against this exact field; see
   * `VerifibetError::MintMismatch`). Read from the account itself rather
   * than assumed to be `CIRCLE_DEVNET_USDC_MINT` — that constant
   * describes every market that exists on devnet *today* (see
   * lib/config.ts's doc comment), not a guarantee for markets initialized
   * later. */
  usdcMint: string;
  /** USDC base units per outcome (0/1/2), as decimal strings — a real
   * on-chain `u64` can exceed `Number.MAX_SAFE_INTEGER`, so this crosses
   * the server/client (and any JSON) boundary as a string, never a
   * `number` or a bare `bigint` (which `JSON.stringify` can't serialize
   * at all). Parse with `BigInt(...)` on the way back out. */
  pools: [string, string, string];
  totalPool: string;
  resolvedAt: number;
}

function decodeMarketStatus(status: Record<string, unknown>): Lowercase<MarketStatus> {
  return Object.keys(status)[0] as Lowercase<MarketStatus>;
}

/** `null` when no `Market` account exists yet for this fixture — a real,
 * common state (see scripts/sync-markets.ts: `initialize_market` requires
 * `kickoff_ts` to still be in the future, so most fixtures in this
 * compressed demo calendar never got one), not an error. */
export async function fetchMarketAccount(fixtureId: number): Promise<MarketAccountData | null> {
  const program = getReadOnlyProgram();
  const [market] = marketPda(program.programId, fixtureId);

  const accountInfo = await program.provider.connection.getAccountInfo(market);
  if (!accountInfo) return null;

  const decoded = program.coder.accounts.decode(MARKET_ACCOUNT_IDL_NAME, accountInfo.data) as {
    fixtureId: BN;
    status: Record<string, unknown>;
    outcome: number;
    pools: [BN, BN, BN];
    totalPool: BN;
    resolvedAt: BN;
    usdcMint: PublicKey;
  };

  return {
    fixtureId: decoded.fixtureId.toNumber(),
    status: decodeMarketStatus(decoded.status),
    outcome: decoded.outcome === 255 ? null : (decoded.outcome as Outcome),
    pools: [decoded.pools[0].toString(), decoded.pools[1].toString(), decoded.pools[2].toString()],
    totalPool: decoded.totalPool.toString(),
    resolvedAt: decoded.resolvedAt.toNumber(),
    usdcMint: decoded.usdcMint.toBase58(),
  };
}

/** Distinct bettors on a market — 0 if the market itself doesn't exist
 * (nothing to count against a PDA that was never derived from a real
 * account). Uses `dataSlice` so the RPC only ever returns the 32-byte
 * `user` field per matching account, not each `Bet`'s full data. */
export async function fetchBettorCount(fixtureId: number): Promise<number> {
  const program = getReadOnlyProgram();
  const [market] = marketPda(program.programId, fixtureId);

  const accounts = await program.provider.connection.getProgramAccounts(program.programId, {
    filters: [{ memcmp: { offset: BET_MARKET_OFFSET, bytes: market.toBase58() } }],
    dataSlice: { offset: BET_USER_OFFSET, length: 32 },
  });

  const distinctUsers = new Set(accounts.map(({ account }) => new PublicKey(account.data).toBase58()));
  return distinctUsers.size;
}

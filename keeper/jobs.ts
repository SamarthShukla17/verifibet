/**
 * The keeper's simple on-chain actions — `syncMarketsJob`, `lockMarketJob`
 * — plus the shared helpers `keeper/resolver.ts`'s heavier `resolveFixture`
 * pipeline reuses (`fetchMarketStatus`, `dailyScoresRootsPda`,
 * `formatTxError`, `KeeperContext`, `loadKeeperKeypair`) so there's exactly
 * one implementation of each, not two that could drift. `resolveMarketJob`
 * used to live here as a self-contained CPI-argument builder; it's been
 * superseded by `keeper/resolver.ts#resolveFixture` (feed-flicker polling,
 * `deriveOutcome`, compute budget + priority fee, tx-size guard, the full
 * failure taxonomy) — `keeper/index.ts` calls that directly now.
 *
 * Every job here re-reads the relevant `Market` account on-chain before
 * doing anything (the idempotency rule `keeper/index.ts`'s doc comment
 * describes — a restart replaying a missed event must never double-act),
 * then either no-ops with a `"skipped"` result or sends exactly one
 * transaction. None of these log themselves; `keeper/index.ts`'s job
 * runner wraps every call and emits the one structured
 * `{job, fixtureId, txSig?, error?}` log line per attempt, so the shape
 * stays identical regardless of which job ran.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";

import { deriveMarket } from "@/lib/solana/pda";
import { syncMarkets, type SyncResult as MarketSyncResult } from "@/scripts/sync-markets";

/** Same fully-qualified-Rust-path quirk documented in `scripts/sync-markets.ts`
 * and `anchor/tests/verifibet.ts` — this build's IDL pipeline emits
 * `"verifibet::state::market"` as the runtime account-client key, not the
 * naively camelCased `"market"`. */
const MARKET_ACCOUNT = "verifibet::state::market";

/** One unix day in milliseconds — `daily_scores_merkle_roots`' seed unit
 * and TxLINE's own `ts` (see `resolve_market.rs`'s `MS_PER_DAY`), unlike
 * this program's usual unix-seconds convention. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAILY_ROOTS_SEED = Buffer.from("daily_scores_roots");

export interface KeeperContext {
  connection: Connection;
  program: anchor.Program;
  keeper: Keypair;
}

/** `KEEPER_SECRET_KEY` — accepts a base58-encoded secret key (the format
 * `.env.local.example` documents) or a JSON `number[]` array (the format
 * `solana-keygen`/`Keypair.fromSecretKey` normally round-trips through) —
 * whichever the operator has on hand. JSON is tried first since it's
 * unambiguous (base58 never starts with `[`). */
export function loadKeeperKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  return Keypair.fromSecretKey(anchor.utils.bytes.bs58.decode(trimmed));
}

/** `Anchor`'s own `AnchorError` simulation dump is a full RPC message plus
 * every program log line — correct but unusable in a one-line structured
 * log. Extracts the stable `Error Code: X. Error Number: N. Error Message:
 * Y.` Anchor always emits for a program-level revert; falls back to the
 * raw message's first line for anything else (network/RPC failure). Same
 * approach as `scripts/sync-markets.ts`'s `formatSyncError`, duplicated
 * rather than imported since that one isn't exported (script-local). */
export function formatTxError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^.]+)\./);
  return match ? `${match[1]} (${match[2]}): ${match[3]}` : message.split("\n")[0];
}

/** Exported so `resolveFixture` can run the same idempotency check
 * (`Resolved`/`Voided` -> skip) before spending any effort building a
 * proof or a transaction — one implementation of "what does this market's
 * on-chain status decode to", not two. */
export async function fetchMarketStatus(
  program: anchor.Program,
  market: PublicKey,
): Promise<Lowercase<import("@/lib/types").MarketStatus> | null> {
  const client = (program.account as Record<string, { fetchNullable(addr: PublicKey): Promise<{ status: Record<string, unknown> } | null> }>)[
    MARKET_ACCOUNT
  ];
  const account = await client.fetchNullable(market);
  if (!account) return null;
  return Object.keys(account.status)[0] as Lowercase<import("@/lib/types").MarketStatus>;
}

/** TxLINE's daily Merkle-root PDA for the epoch day implied by `ts` (ms) —
 * mirrors `resolve_market.rs`'s own `(ts / MS_PER_DAY).clamp(0, u16::MAX)`
 * seed expression exactly (see that file's doc comment for why it's
 * clamped: a keeper-supplied `ts` is otherwise an unclamped cast). Owned by
 * TxLINE's program, not ours — `seeds::program` on the Rust side. */
export function dailyScoresRootsPda(ts: number, txlineProgramId: PublicKey): PublicKey {
  const epochDay = Math.min(Math.max(Math.floor(ts / MS_PER_DAY), 0), 0xffff);
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(epochDay);
  return PublicKey.findProgramAddressSync([DAILY_ROOTS_SEED, seed], txlineProgramId)[0];
}

export interface SyncJobResult {
  created: number;
  existing: number;
  failed: number;
}

/** Wraps `scripts/sync-markets.ts`'s `syncMarkets` — same idempotent
 * fixtures -> markets sync the standalone script runs, reused here so the
 * hourly tick and the script stay one implementation. */
export async function syncMarketsJob(ctx: KeeperContext): Promise<SyncJobResult> {
  const results: MarketSyncResult[] = await syncMarkets(ctx.connection, ctx.program, ctx.keeper);
  const counts = { created: 0, existing: 0, failed: 0 };
  for (const r of results) {
    if (r.outcome === "created") counts.created++;
    else if (r.outcome === "existing") counts.existing++;
    else if (r.outcome === "failed") counts.failed++;
  }
  return counts;
}

export interface LockJobResult {
  action: "locked" | "skipped";
  status: string;
  txSig?: string;
}

/**
 * `lock_market` — re-reads the market's on-chain status first and only
 * acts if it's still `Open`; any other status (already `Locked` by a
 * prior attempt, or further along) is a no-op `"skipped"` result, not an
 * error. This is what makes a keeper restart safe to replay `onKickoff`
 * for a fixture it already locked before crashing.
 */
export async function lockMarketJob(ctx: KeeperContext, fixtureId: number): Promise<LockJobResult> {
  const [market] = deriveMarket(BigInt(fixtureId));
  const status = await fetchMarketStatus(ctx.program, market);

  if (status === null) {
    throw new Error(`market for fixture ${fixtureId} does not exist on-chain yet`);
  }
  if (status !== "open") {
    return { action: "skipped", status };
  }

  const tx = await ctx.program.methods
    .lockMarket()
    .accountsStrict({ authority: ctx.keeper.publicKey, market })
    .transaction();
  tx.feePayer = ctx.keeper.publicKey;

  try {
    const txSig = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.keeper], {
      commitment: "confirmed",
    });
    return { action: "locked", status, txSig };
  } catch (err) {
    throw new Error(formatTxError(err));
  }
}

/**
 * Idempotent fixtures -> markets sync — the thing that makes "auto-
 * generates markets for all known matches" (see CLAUDE.md) a real,
 * running capability rather than just a claim. For every International
 * Friendlies fixture TxLINE has, derive its Market PDA, skip it if the
 * account already exists, else `initialize_market`. Safe to run
 * repeatedly: an already-synced fixture is always a no-op.
 *
 * `syncMarkets` is exported for reuse — the keeper (Session 6.4) imports
 * it directly rather than shelling out to this file, so it stays free of
 * CLI-only concerns (arg parsing, `.env.local` loading, `console.log`
 * narration) beyond the `main()` block at the bottom, which only runs
 * when this file is executed directly.
 *
 * Originally this synced World Cup fixtures (`competitionId=72`) against a
 * fixed, hardcoded tournament window (`TOURNAMENT_START_EPOCH_DAY`) — that
 * window had, by the time of this rewrite, fully elapsed relative to
 * devnet's real clock (every World Cup fixture long since kicked off,
 * `KickoffPassed` on any resync attempt). Switched to Int'l Friendlies
 * (`competitionId=430`, same free devnet Service Level 1 subscription, no
 * TxL purchase needed — see CLAUDE.md's TxLINE section) specifically
 * because TxLINE's devnet friendlies fixtures are genuinely upcoming
 * (confirmed empirically: Sept/Oct/Nov 2026 kickoffs against today's real
 * clock), so no start-window override is needed at all — omitting
 * `startEpochDay` already returns exactly the right set.
 *
 * ## "Upcoming" is TxLINE data's job to decide, not a client-side filter
 *
 * This still fetches whatever TxLINE returns for the competition rather
 * than pre-filtering to `StartTime > now` itself. `initialize_market`'s
 * own on-chain constraint (`kickoff_ts > Clock::get()?.unix_timestamp`,
 * see `anchor/programs/verifibet/src/instructions/initialize_market.rs`)
 * is already the authoritative "is this fixture still eligible" check —
 * a client-side wall-clock pre-filter would just make an unexpectedly
 * past fixture vanish silently instead of being honestly attempted and
 * reported as a `KickoffPassed` failure, which defeats the point of an
 * idempotent sync tool's summary table.
 *
 * `--fixture <id>` narrows a run to one fixture (still drawn from the
 * same full fetch, not just "upcoming" ones) — useful for backfilling a
 * single fixture without re-attempting every other already-decided one.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { deriveMarket } from "@/lib/solana/pda";
import type { TxFixture } from "@/lib/txline/types";
import verifibetIdl from "@/lib/solana/idl/verifibet.json";

const FRIENDLIES_COMPETITION_ID = 430;

// Same MARKET_ACCOUNT quirk documented in scripts/devnet-e2e.ts and
// anchor/tests/verifibet.ts: this build's IDL pipeline emits fully-
// qualified Rust account type paths, and Anchor's client-side camelCase
// pass doesn't touch the `::` separators, so the runtime key on
// `program.account` doesn't match the naive camelCased name.
const MARKET_ACCOUNT = "verifibet::state::market";

const SEND_INTERVAL_MS = 400;

/** Truncates to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte code point — mirrors `initialize_market`'s own
 * `home.len() <= 24` / `away.len() <= 24` check (bytes, via Borsh's
 * `String` encoding), which is what the on-chain program actually
 * enforces (see `#[max_len(24)]` on `Market.home`/`away` in state.rs and
 * NOTES.md's note on why a char-count check would under-count multi-byte
 * names). Walking with `for...of` iterates by Unicode code point, not
 * UTF-16 code unit, so this never splits a surrogate pair either. */
export function truncateToBytes(name: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(name).length <= maxBytes) return name;

  let result = "";
  for (const ch of name) {
    const candidate = result + ch;
    if (encoder.encode(candidate).length > maxBytes) break;
    result = candidate;
  }
  return result;
}

export interface SyncMarketsOptions {
  /** Build and log what *would* happen; never sends a transaction. */
  dryRun?: boolean;
  /** Sync only this one fixture (still drawn from the full tournament window). */
  fixtureId?: number;
  /** Defaults to `CONFIG.devnet.usdcMint` (loaded lazily — see below). */
  usdcMint?: PublicKey;
  /**
   * Demo-only escape hatch, paired 1:1 with `fixtureId` — overrides the
   * on-chain `kickoff_ts` instead of using the fixture's real
   * (long-elapsed, see module doc comment) `StartTime`. Every other field
   * (fixture id, real team names, real historical kickoff logged in the
   * summary) stays real; only the timestamp gating `place_bet`'s
   * `KickoffPassed` check is shifted forward so a live demo can actually
   * bet against it. Never used by the keeper or a bare `syncMarkets` call
   * across the full tournament — only `--fixture` + `--kickoff` together.
   */
  kickoffOverrideTs?: number;
}

export type SyncOutcome = "created" | "existing" | "failed" | "dry-run";

export interface SyncResult {
  fixtureId: number;
  home: string;
  away: string;
  kickoffTs: number;
  marketPda: string;
  outcome: SyncOutcome;
  txSig?: string;
  error?: string;
}

/** Exported for `scripts/seed-bets.ts`, which needs the same real
 * fixture list to pick fresh (not-yet-marketed) fixtures from — kept as
 * one function rather than a second copy of the `txlineFetch` call. No
 * `startEpochDay` — omitting it defaults to the real current day, which
 * already returns the full upcoming Friendlies set (see module doc
 * comment on why that's enough, unlike the old World Cup window). */
export async function fetchTournamentFixtures(fixtureId?: number): Promise<TxFixture[]> {
  const { txlineFetch } = await import("@/lib/txline/http");
  const res = await txlineFetch(`/api/fixtures/snapshot?competitionId=${FRIENDLIES_COMPETITION_ID}`);
  const fixtures = (await res.json()) as TxFixture[];
  return fixtureId === undefined ? fixtures : fixtures.filter((f) => f.FixtureId === fixtureId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `sendAndConfirmTransaction` (raw `@solana/web3.js`, not Anchor's own
 * `.rpc()`) doesn't parse the on-chain `AnchorError` out of a failed
 * simulation for us — the caught error's `.message` is the full
 * simulation dump (RPC message + every program log line), which is
 * correct but unusable in a summary table. Anchor's own error format is
 * stable and greppable straight out of that dump (`Error Code: X. Error
 * Number: N. Error Message: Y.`), so this just extracts it with a regex
 * rather than pulling in a heavier parsing path — falls back to the raw
 * message's first line for anything that isn't a program-level revert
 * (a real network/RPC failure, say).
 */
function formatSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^.]+)\./);
  return match ? `${match[1]} (${match[2]}): ${match[3]}` : message.split("\n")[0];
}

/**
 * Syncs every fixture TxLINE returns (see the module doc comment for why
 * that's not pre-filtered to "upcoming") to a Market PDA — idempotent,
 * safe to call repeatedly. `program` must already be constructed against
 * `connection`; `keeper` signs and pays for every `initialize_market` it
 * sends (independent of whatever wallet `program`'s own provider carries
 * — this only uses `program` to build instructions/accounts).
 */
export async function syncMarkets(
  connection: Connection,
  program: anchor.Program,
  keeper: Keypair,
  options: SyncMarketsOptions = {},
): Promise<SyncResult[]> {
  const resolvedUsdcMint =
    options.usdcMint ?? new PublicKey((await import("@/lib/config")).CONFIG.devnet.usdcMint);

  const fixtures = await fetchTournamentFixtures(options.fixtureId);
  const marketAccountClient = (program.account as any)[MARKET_ACCOUNT];

  const results: SyncResult[] = [];

  for (const fixture of fixtures) {
    const realKickoffTs = Math.floor(fixture.StartTime / 1000);
    const kickoffTs =
      options.kickoffOverrideTs !== undefined && fixture.FixtureId === options.fixtureId
        ? options.kickoffOverrideTs
        : realKickoffTs;
    const home = fixture.Participant1IsHome ? fixture.Participant1 : fixture.Participant2;
    const away = fixture.Participant1IsHome ? fixture.Participant2 : fixture.Participant1;
    const truncatedHome = truncateToBytes(home, 24);
    const truncatedAway = truncateToBytes(away, 24);

    const fixtureIdBn = new BN(fixture.FixtureId);
    const [market] = deriveMarket(BigInt(fixture.FixtureId));

    const base: Omit<SyncResult, "outcome"> = {
      fixtureId: fixture.FixtureId,
      home: truncatedHome,
      away: truncatedAway,
      kickoffTs,
      marketPda: market.toBase58(),
    };

    const existing = await marketAccountClient.fetchNullable(market);
    if (existing) {
      results.push({ ...base, outcome: "existing" });
      continue;
    }

    if (options.dryRun) {
      results.push({ ...base, outcome: "dry-run" });
      continue;
    }

    try {
      const vault = getAssociatedTokenAddressSync(resolvedUsdcMint, market, true);
      const tx = await program.methods
        .initializeMarket(fixtureIdBn, truncatedHome, truncatedAway, new BN(kickoffTs))
        .accountsStrict({
          authority: keeper.publicKey,
          market,
          usdcMint: resolvedUsdcMint,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      tx.feePayer = keeper.publicKey;

      const txSig = await sendAndConfirmTransaction(connection, tx, [keeper], {
        commitment: "confirmed",
      });
      results.push({ ...base, outcome: "created", txSig });
    } catch (err) {
      results.push({ ...base, outcome: "failed", error: formatSyncError(err) });
    }

    // Only pace actual on-chain sends — skips (existing/dry-run) are free
    // RPC reads and don't need throttling.
    await sleep(SEND_INTERVAL_MS);
  }

  return results;
}

export function printSummary(results: SyncResult[]): void {
  const counts = { created: 0, existing: 0, failed: 0, "dry-run": 0 } as Record<SyncOutcome, number>;
  for (const r of results) counts[r.outcome]++;

  console.log("\n--- sync-markets summary ---");
  console.log(
    `${"fixtureId".padEnd(10)} ${"home".padEnd(22)} ${"away".padEnd(22)} ${"outcome".padEnd(10)} detail`,
  );
  for (const r of results) {
    const detail = r.txSig ?? r.error ?? r.marketPda;
    console.log(
      `${String(r.fixtureId).padEnd(10)} ${r.home.padEnd(22)} ${r.away.padEnd(22)} ${r.outcome.padEnd(10)} ${detail}`,
    );
  }
  console.log(
    `\ncreated: ${counts.created}  existing: ${counts.existing}  failed: ${counts.failed}  dry-run: ${counts["dry-run"]}  (total ${results.length})`,
  );
}

function parseArgs(argv: string[]): SyncMarketsOptions {
  const options: SyncMarketsOptions = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") options.dryRun = true;
    else if (argv[i] === "--fixture") options.fixtureId = Number(argv[++i]);
    else if (argv[i] === "--kickoff") options.kickoffOverrideTs = Number(argv[++i]);
  }
  if (options.kickoffOverrideTs !== undefined && options.fixtureId === undefined) {
    throw new Error("--kickoff requires --fixture (demo override is single-fixture only)");
  }
  return options;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const { CONFIG } = await import("@/lib/config");

  const options = parseArgs(process.argv.slice(2));
  const keeper = loadKeypair(join(homedir(), ".config", "solana", "id.json"));
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keeper), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(
    { ...(verifibetIdl as anchor.Idl), address: programId.toBase58() },
    provider,
  );

  console.log(`keeper:  ${keeper.publicKey.toBase58()}`);
  console.log(`program: ${program.programId.toBase58()}`);
  console.log(`mode:    ${options.dryRun ? "dry-run" : "live"}${options.fixtureId ? `, fixture ${options.fixtureId}` : ""}`);

  const results = await syncMarkets(connection, program, keeper, options);
  printSummary(results);

  if (results.some((r) => r.outcome === "failed")) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

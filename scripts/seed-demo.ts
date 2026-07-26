/**
 * One-shot, idempotent demo-environment setup: creates on-chain `Market`
 * accounts for the five demo scenarios' own fixture identities (the
 * `+9,000,000`-offset "demo range" — see `lib/txline/demoScenarios.ts`'s
 * `DEMO_FIXTURE_OFFSET` — the same fixture ids `demo-data/scenarios/*.rest.json`
 * already embed and `components/DemoReplayBanner.tsx`'s pill already
 * narrates), places 15-25 varied bets on them from the same
 * `demo-alice`/`demo-bob`/`demo-carol` wallets `scripts/seed-bets.ts`
 * uses, then resolves two *real* fixtures (not demo-range ones — see
 * below) through the keeper's actual backfill path so `/leaderboard`,
 * `/portfolio`, and `/receipts/<fixtureId>` all have genuine settled
 * content, not just open markets.
 *
 * ## Why resolution targets real fixture ids, not the demo range
 *
 * `resolve_market`'s CPI only ever succeeds against TxLINE's own
 * on-chain Merkle-anchored data (see `resolve_market.rs`'s module doc
 * comment) — there is no way to resolve a fabricated demo-range fixture
 * id through it, TxLINE has never heard of fixture `27175983`. So this
 * script resolves two real fixture ids instead — `qf-thriller` (18222446,
 * Argentina v Switzerland, resolved by this script) and `underdog`
 * (18187298, Brazil v Norway, already resolved by an earlier session —
 * `resolveFixture` is idempotent, so re-listing it here just confirms
 * that state rather than re-doing work; `Market` PDAs are global, not
 * per-wallet, so a judge running this fresh sees the same "already
 * resolved" for free). `final-preview`'s real fixture id (18257739) is
 * also already resolved, untouched.
 *
 * Two of the five scenarios' real fixtures are deliberately **excluded**
 * from this list, both confirmed live this session, not assumed:
 *
 * - `pens` (18175983, Germany v Paraguay): permanently unresolvable
 *   through the real CPI. That match finished level after extra time and
 *   was decided on penalties; `resolve_market.rs`'s own module doc
 *   comment documents that its proof only ever covers an FT+ET goal
 *   *difference*, with no on-chain representation of a shootout at all —
 *   submitting the real winner (Paraguay) would fail the CPI's own
 *   predicate (the proof only supports "draw"), so `resolveFixtureInner`
 *   correctly refuses with a `CpiValidationFailureError` rather than
 *   resolving dishonestly. The documented trust boundary working as
 *   intended, not a bug — its market is left genuinely `Open`.
 * - `late-drama` (18175918, Argentina v Cape Verde): TxLINE's own
 *   `validate_stat` CPI rejects this fixture's real proof with
 *   `TimestampMismatch` ("timestamp provided for seed generation does
 *   not match the timestamp in the snapshot payload") — reproduced twice,
 *   not a one-off network blip, and specific to this one fixture's proof
 *   data (`qf-thriller`'s otherwise-identical code path resolves
 *   cleanly). This looks like a TxLINE devnet data issue outside this
 *   program's control, not a bug in `resolveFixtureInner`/`fetchProof` —
 *   flagged here rather than routed around silently. Its market is left
 *   `Open`, same as `pens`'s.
 *
 * ## The "one claimable win" invariant
 *
 * `scripts/demoRig.ts#ensureExactlyOneClaimableWin` does the actual work
 * — see that module's own doc comment for the full reasoning. In short:
 * this project's own dev wallet already holds a genuine unclaimed win
 * from an earlier session (the real, resolved World Cup Final), which
 * that function finds and reuses; a judge running this fresh has no such
 * bet, so it fabricates one honestly instead (a real, historical,
 * already-decided fixture, resolved through the same backfill path).
 * Resolving `qf-thriller` above incidentally turns the dev wallet's
 * *existing* small bet on Argentina into a second technically-claimable
 * win — `ensureExactlyOneClaimableWin` claims extras like that away
 * immediately (bypassing the UI, whose CLAIM button is still a
 * placeholder — see `lib/solana/program.ts#claimWinnings`'s own doc
 * comment), leaving exactly one outstanding either way. The result is
 * persisted to `.demo-state.json` (gitignored) so `scripts/reset-demo.ts`
 * knows which bet to watch and re-arm between video takes.
 *
 * Usage: pnpm tsx scripts/seed-demo.ts  (or `pnpm seed:demo`)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import pino from "pino";
import { sha256 } from "@noble/hashes/sha2.js";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, type VersionedTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import { deriveMarket, deriveBet, PROGRAM_ID } from "@/lib/solana/pda";
import { getProgram, getReadOnlyProgram, BET_ACCOUNT_IDL_NAME, MARKET_ACCOUNT_IDL_NAME, placeBet } from "@/lib/solana/program";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import { truncateToBytes, syncMarkets } from "@/scripts/sync-markets";
import { buildKeeperContext } from "@/keeper/context";
import { resolveFixture } from "@/keeper/resolver";
import { ensureExactlyOneClaimableWin } from "@/scripts/demoRig";
import { explorerAddressUrl } from "@/lib/explorer";
import { formatUsdc } from "@/lib/format";
import { loadDemoScenarios } from "@/lib/txline/demoScenarios";
import type { Outcome } from "@/lib/types";
import { DEMO_STATE_PATH } from "@/scripts/demoState";

// ---------------------------------------------------------------------------
// Demo wallets — same deterministic derivation as scripts/seed-bets.ts
// (literal, auditable seed string — see that file's own doc comment for
// why this isn't randomly generated). Duplicated rather than imported so
// this script has no dependency on seed-bets.ts ever changing out from
// under it; both must stay byte-identical to keep addressing the same
// three wallets, which is why the seed string itself is quoted verbatim
// in both places instead of computed differently.
// ---------------------------------------------------------------------------
const DEMO_NAMES = ["demo-alice", "demo-bob", "demo-carol"] as const;
type DemoName = (typeof DEMO_NAMES)[number];
const DEMO_SEED_PREFIX = "verifibet-demo-wallet:";
function deriveDemoKeypair(name: DemoName): Keypair {
  return Keypair.fromSeed(sha256(new TextEncoder().encode(DEMO_SEED_PREFIX + name)));
}

const SOL_FUNDING_LAMPORTS = 0.05 * anchor.web3.LAMPORTS_PER_SOL;

/** Real fixture ids resolved via the keeper's genuine backfill path —
 * see module doc comment for why `pens` and `late-drama`'s real ids are
 * deliberately absent (one permanently unresolvable by design, one a
 * reproducible TxLINE-side proof error), and why listing `underdog`
 * (already resolved by an earlier session) here is still correct, not
 * redundant. */
const REAL_FIXTURES_TO_RESOLVE = [18222446, 18187298] as const;

/** Real fixture ids `ensureExactlyOneClaimableWin` should check for an
 * existing valid win before fabricating a fresh one — every real fixture
 * this project's demo scenarios touch that's actually resolvable, resolved
 * or not (see `scripts/demoRig.ts`). `pens`/`late-drama` (18175983/18175918)
 * are excluded — see `REAL_FIXTURES_TO_RESOLVE`'s doc comment. */
const KNOWN_REAL_FIXTURE_IDS = [18222446, 18187298, 18257739];

/** Minutes of headroom between a freshly demo-range-initialized market's
 * kickoff and "now" — long enough to place every planned bet in this
 * script's single run, short enough that a re-run a few minutes later
 * still finds it in the past (place_bet's own on-chain `KickoffPassed`
 * guard) rather than silently staying open forever. */
const DEMO_RANGE_KICKOFF_BUFFER_SECONDS = 20 * 60;

interface DemoBetPlan {
  wallet: DemoName;
  /** Demo-range fixture id (the `+9,000,000` one). */
  fixtureId: number;
  outcome: Outcome;
  amountUsdc: number;
}

/**
 * 20 bets, deliberately varied: every wallet bets on every one of the
 * five demo-range markets at least once, several markets get both
 * outcomes backed by different wallets, and amounts are never round —
 * `/leaderboard`'s Volume column and each market's pool split should
 * both look like real, independent activity, not a generated fixture.
 * All five underlying real matches are knockout-stage, so outcome is
 * only ever 0/2 (see `lib/market.ts#isKnockoutStage` — no Draw tile
 * exists for these in the real UI either).
 */
function buildBetPlan(fixtureIds: Record<string, number>): DemoBetPlan[] {
  const { pens, "qf-thriller": qfThriller, underdog, "late-drama": lateDrama, "final-preview": finalPreview } = fixtureIds;
  return [
    { wallet: "demo-alice", fixtureId: pens, outcome: 0, amountUsdc: 8 },
    { wallet: "demo-alice", fixtureId: pens, outcome: 2, amountUsdc: 3.5 },
    { wallet: "demo-alice", fixtureId: qfThriller, outcome: 2, amountUsdc: 6 },
    { wallet: "demo-alice", fixtureId: qfThriller, outcome: 0, amountUsdc: 2 },
    { wallet: "demo-alice", fixtureId: underdog, outcome: 0, amountUsdc: 10 },
    { wallet: "demo-alice", fixtureId: underdog, outcome: 2, amountUsdc: 5.5 },
    { wallet: "demo-alice", fixtureId: lateDrama, outcome: 2, amountUsdc: 4.25 },
    { wallet: "demo-alice", fixtureId: finalPreview, outcome: 0, amountUsdc: 15 },
    { wallet: "demo-bob", fixtureId: pens, outcome: 2, amountUsdc: 5 },
    { wallet: "demo-bob", fixtureId: qfThriller, outcome: 0, amountUsdc: 9 },
    { wallet: "demo-bob", fixtureId: underdog, outcome: 2, amountUsdc: 2.75 },
    { wallet: "demo-bob", fixtureId: lateDrama, outcome: 0, amountUsdc: 12 },
    { wallet: "demo-bob", fixtureId: lateDrama, outcome: 2, amountUsdc: 6.5 },
    { wallet: "demo-bob", fixtureId: finalPreview, outcome: 2, amountUsdc: 3 },
    { wallet: "demo-carol", fixtureId: pens, outcome: 0, amountUsdc: 6.5 },
    { wallet: "demo-carol", fixtureId: qfThriller, outcome: 2, amountUsdc: 20 },
    { wallet: "demo-carol", fixtureId: underdog, outcome: 0, amountUsdc: 1.5 },
    { wallet: "demo-carol", fixtureId: lateDrama, outcome: 2, amountUsdc: 8 },
    { wallet: "demo-carol", fixtureId: finalPreview, outcome: 0, amountUsdc: 4 },
    { wallet: "demo-carol", fixtureId: finalPreview, outcome: 2, amountUsdc: 9.25 },
  ];
}

function loadDevKeypair(): Keypair {
  const raw = JSON.parse(readFileSync(join(homedir(), ".config", "solana", "id.json"), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Same `WalletContextState` stand-in `scripts/seed-bets.ts`/`scripts/bet-e2e.ts`
 * use — a real `Keypair` satisfying just enough of the interface for
 * `getProgram`/`sendAndConfirm` to accept it. */
function keypairWallet(keypair: Keypair): WalletContextState {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
      if (tx instanceof Transaction) tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      for (const tx of txs) if (tx instanceof Transaction) tx.partialSign(keypair);
      return txs;
    },
    sendTransaction: async (tx: Transaction, connection: Connection) => {
      tx.partialSign(keypair);
      return connection.sendRawTransaction(tx.serialize());
    },
  } as unknown as WalletContextState;
}

function resolveDevnetRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
}

/** Pacing between on-chain sends, same as `scripts/sync-markets.ts`'s own
 * `SEND_INTERVAL_MS` — this script's total RPC call volume (5 market
 * inits + funding + 20 bets + 2 real resolutions) is high enough to
 * reliably trip the public devnet RPC's rate limit without it (CLAUDE.md
 * already flags this: get a Helius devnet key to avoid it entirely). */
const SEND_INTERVAL_MS = 500;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUsdcMint(): PublicKey {
  return new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
}

/** Idempotent — skips any demo-range market that already exists,
 * exactly like `scripts/sync-markets.ts#syncMarkets`. Doesn't reuse that
 * function directly: it fetches fixture identity from TxLINE's real REST
 * snapshot, which has never heard of a demo-range fixture id — this
 * reads identity from the already-committed scenario `.rest.json` files
 * instead (`loadDemoScenarios()`), the same source
 * `lib/txline/demoScenarios.ts` uses everywhere else. */
async function ensureDemoRangeMarkets(
  connection: Connection,
  program: anchor.Program,
  authority: Keypair,
  usdcMint: PublicKey,
): Promise<Record<string, number>> {
  const scenarios = loadDemoScenarios();
  const marketClient = (program.account as any)[MARKET_ACCOUNT_IDL_NAME];
  const fixtureIds: Record<string, number> = {};
  const kickoffTs = Math.floor(Date.now() / 1000) + DEMO_RANGE_KICKOFF_BUFFER_SECONDS;

  console.log(`\n--- demo-range markets (kickoff override: ${new Date(kickoffTs * 1000).toISOString()}) ---`);
  for (const scenario of scenarios) {
    const { scenario: name, demoFixtureId } = scenario.meta;
    fixtureIds[name] = demoFixtureId;
    const [market] = deriveMarket(BigInt(demoFixtureId));

    const existing = await marketClient.fetchNullable(market);
    if (existing) {
      console.log(`[${name}] fixture ${demoFixtureId} — market already exists (${market.toBase58()}), skipping`);
      continue;
    }

    const { fixture } = scenario;
    const home = truncateToBytes(fixture.Participant1IsHome ? fixture.Participant1 : fixture.Participant2, 24);
    const away = truncateToBytes(fixture.Participant1IsHome ? fixture.Participant2 : fixture.Participant1, 24);
    const vault = getAssociatedTokenAddressSync(usdcMint, market, true);

    const tx = await program.methods
      .initializeMarket(new BN(demoFixtureId), home, away, new BN(kickoffTs))
      .accountsStrict({
        authority: authority.publicKey,
        market,
        usdcMint,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    tx.feePayer = authority.publicKey;

    const txSig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
    console.log(
      `[${name}] fixture ${demoFixtureId} (${home} v ${away}) -> created market ${market.toBase58()} — ${txSig}`,
    );
    await sleep(SEND_INTERVAL_MS);
  }

  return fixtureIds;
}

/** Idempotent per (wallet, market, outcome): skips a planned bet whose
 * `Bet` PDA already has a nonzero `amount` on-chain — safe to re-run
 * this script without accumulating extra stake on every invocation,
 * unlike `scripts/seed-bets.ts`'s own bet-placement step (see that
 * file's doc comment, which explicitly accepts non-idempotent
 * re-betting; this script's own spec calls for idempotent instead). */
async function placeVariedBets(connection: Connection, plan: DemoBetPlan[]): Promise<void> {
  const usdcMint = resolveUsdcMint();
  const readOnly = await getReadOnlyProgram();
  const betClient = (readOnly.account as any)[BET_ACCOUNT_IDL_NAME];

  const totalNeededByWallet = new Map<DemoName, number>();
  for (const bet of plan) {
    totalNeededByWallet.set(bet.wallet, (totalNeededByWallet.get(bet.wallet) ?? 0) + bet.amountUsdc);
  }

  console.log(`\n--- funding demo wallets ---`);
  const devWallet = loadDevKeypair();
  const demoKeypairs = new Map<DemoName, Keypair>();
  for (const name of DEMO_NAMES) {
    const keypair = deriveDemoKeypair(name);
    demoKeypairs.set(name, keypair);

    const solTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: devWallet.publicKey,
        toPubkey: keypair.publicKey,
        lamports: SOL_FUNDING_LAMPORTS,
      }),
    );
    await anchor.web3.sendAndConfirmTransaction(connection, solTx, [devWallet], { commitment: "confirmed" });
    await sleep(SEND_INTERVAL_MS);

    const ata = await getOrCreateAssociatedTokenAccount(connection, devWallet, usdcMint, keypair.publicKey);
    const neededUsdc = totalNeededByWallet.get(name) ?? 0;
    const mintAmount = Math.round(neededUsdc * 1_000_000 * 2); // headroom, same as seed-bets.ts
    await mintTo(connection, devWallet, usdcMint, ata.address, devWallet, mintAmount);
    console.log(`${name}: ${keypair.publicKey.toBase58()} — funded ${formatUsdc(BigInt(mintAmount))} USDC`);
    await sleep(SEND_INTERVAL_MS);
  }

  console.log(`\n--- placing ${plan.length} varied bets ---`);
  for (const p of plan) {
    const keypair = demoKeypairs.get(p.wallet)!;
    const [market] = deriveMarket(BigInt(p.fixtureId));
    const [bet] = deriveBet(market, keypair.publicKey, p.outcome);
    const existing = await betClient.fetchNullable(bet);
    if (existing && existing.amount.toNumber() > 0) {
      console.log(`${p.wallet.padEnd(11)} fixture ${p.fixtureId} outcome ${p.outcome} — already placed, skipping`);
      continue;
    }

    const wallet = keypairWallet(keypair);
    const program = await getProgram(connection, wallet);
    const tx = await placeBet(program, {
      fixtureId: BigInt(p.fixtureId),
      outcome: p.outcome,
      amountBaseUnits: BigInt(Math.round(p.amountUsdc * 1_000_000)),
    });
    const signature = await sendAndConfirm(connection, wallet, tx, {
      label: `${p.wallet} betting ${p.amountUsdc} USDC on fixture ${p.fixtureId}`,
    });
    console.log(
      `${p.wallet.padEnd(11)} ${String(p.amountUsdc).padStart(6)} USDC on outcome ${p.outcome} (fixture ${p.fixtureId}) — ${signature}`,
    );
    await sleep(SEND_INTERVAL_MS);
  }
}

/** Real-World-Cup-fixture kickoff buffer for a market that's never been
 * synced before (`late-drama`'s real id, unlike `pens`/`qf-thriller`,
 * has no on-chain market from an earlier session) — long enough for the
 * sync tx to land, short enough the script isn't kept waiting. */
const REAL_MARKET_KICKOFF_BUFFER_SECONDS = 30;

/** `initialize_market` requires `kickoff_ts` in the *future*;
 * `resolve_market` requires it in the *past* — so a freshly-synced real
 * fixture needs a real wait between the two, not just a kickoff override.
 * Idempotent: `syncMarkets` itself skips any fixture that already has a
 * market (e.g. `qf-thriller`'s, already `Open` from an earlier session
 * with its own already-past kickoff — this never touches that one). */
async function ensureRealMarketsSynced(connection: Connection, devWallet: Keypair, usdcMint: PublicKey): Promise<void> {
  console.log(`\n--- ensuring real-fixture markets exist for the backfill targets ---`);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(devWallet), { commitment: "confirmed" });
  const verifibetIdl = (await import("@/lib/solana/idl/verifibet.json")).default;
  const devProgram = new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);

  let syncedAny = false;
  for (const fixtureId of REAL_FIXTURES_TO_RESOLVE) {
    const kickoffOverrideTs = Math.floor(Date.now() / 1000) + REAL_MARKET_KICKOFF_BUFFER_SECONDS;
    const [result] = await syncMarkets(connection, devProgram, devWallet, { fixtureId, kickoffOverrideTs, usdcMint });
    console.log(`fixture ${fixtureId} — ${result.outcome}${result.txSig ? ` — ${result.txSig}` : ""}`);
    if (result.outcome === "created") syncedAny = true;
    await sleep(SEND_INTERVAL_MS);
  }

  if (syncedAny) {
    console.log(`waiting ${REAL_MARKET_KICKOFF_BUFFER_SECONDS + 5}s for the fresh kickoff override(s) to pass...`);
    await sleep((REAL_MARKET_KICKOFF_BUFFER_SECONDS + 5) * 1000);
  }
}

/** Resolves `REAL_FIXTURES_TO_RESOLVE` via the exact same backfill path
 * `pnpm keeper:resolve --fixture <id>` uses (`keeper/resolver.ts#resolveFixture`)
 * — genuine TxLINE CPI validation, not a shortcut. Idempotent via that
 * function's own `status !== "open" && status !== "locked"` skip. One
 * fixture's failure (network hiccup, an unresolvable-by-design match —
 * see `resolveFixture`'s own `CpiValidationFailureError`) is logged and
 * skipped rather than aborting the rest of the batch — these are
 * independent resolutions, not a transaction. */
async function backfillResolveRealFixtures(logger: pino.Logger): Promise<void> {
  console.log(`\n--- resolving ${REAL_FIXTURES_TO_RESOLVE.length} real fixtures via the keeper backfill path ---`);
  const ctx = await buildKeeperContext(logger);
  for (const fixtureId of REAL_FIXTURES_TO_RESOLVE) {
    try {
      const result = await resolveFixture(ctx, fixtureId, logger);
      if (result.action === "resolved") {
        console.log(`fixture ${fixtureId} resolved — outcome ${result.outcome} — ${result.explorerUrl}`);
      } else {
        console.log(`fixture ${fixtureId} — ${result.action}${result.status ? ` (status: ${result.status})` : ""}`);
      }
    } catch (err) {
      console.error(`fixture ${fixtureId} — resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  const connection = new Connection(resolveDevnetRpcUrl(), "confirmed");
  const devWallet = loadDevKeypair();
  const usdcMint = resolveUsdcMint();
  const logger = pino({ level: "info" }); // stdout only — see module doc comment on not polluting the keeper's Redis dashboard

  console.log(`dev/presenter wallet: ${devWallet.publicKey.toBase58()}`);
  console.log(`program:              ${PROGRAM_ID.toBase58()}  (${explorerAddressUrl(PROGRAM_ID.toBase58())})`);
  console.log(`mock USDC:            ${usdcMint.toBase58()}`);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(devWallet), { commitment: "confirmed" });
  const verifibetIdl = (await import("@/lib/solana/idl/verifibet.json")).default;
  const devProgram = new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);

  const demoRangeFixtureIds = await ensureDemoRangeMarkets(connection, devProgram, devWallet, usdcMint);
  const betPlan = buildBetPlan(demoRangeFixtureIds);
  await placeVariedBets(connection, betPlan);
  await ensureRealMarketsSynced(connection, devWallet, usdcMint);
  await backfillResolveRealFixtures(logger);

  const state = await ensureExactlyOneClaimableWin(connection, devWallet, logger, KNOWN_REAL_FIXTURE_IDS);

  console.log(`\n✅ Demo environment seeded.`);
  console.log(`   leaderboard: /leaderboard`);
  console.log(`   portfolio:   /portfolio  (connect the presenter wallet, ${devWallet.publicKey.toBase58()})`);
  for (const fixtureId of REAL_FIXTURES_TO_RESOLVE) {
    console.log(`   receipt:     /receipts/${fixtureId}`);
  }
  console.log(`   state file:  ${DEMO_STATE_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

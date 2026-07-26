/**
 * Shared "ensure the presenter wallet has exactly one genuine, unclaimed
 * winning bet" logic — used by both `scripts/seed-demo.ts` (initial
 * setup) and `scripts/reset-demo.ts` (re-arming between video takes).
 * Reused rather than duplicated because it's the one non-trivial thing
 * both scripts need: find an existing valid win, or fabricate a fresh
 * one honestly (real fixture, real historical result, real backfill
 * resolution), then make sure exactly one is left outstanding.
 *
 * ## Why this can't just hardcode "the Final" as the designated win
 *
 * This project's own dev wallet already holds a genuine unclaimed win on
 * the real World Cup Final (fixture 18257739) from an earlier session —
 * convenient, but only true for *this specific wallet*. A judge running
 * `pnpm seed:demo` with their own fresh keypair has no such bet (`Bet`
 * PDAs are keyed by `[market, user, outcome]` — a different `user` is a
 * different, nonexistent account), so `ensureExactlyOneClaimableWin`
 * below always checks live on-chain state first and only fabricates a
 * fresh win when nothing valid already exists — the same code path
 * whether it's this machine's fourth run or a judge's first.
 *
 * ## How a fresh win gets fabricated, honestly
 *
 * `resolve_market`'s CPI only succeeds against TxLINE's genuine
 * Merkle-anchored data (see `resolve_market.rs`), so "fabricate a win"
 * cannot mean picking an outcome and lying about it — it means picking a
 * real, already-finished, not-yet-marketed World Cup fixture, checking
 * what *actually* happened (`deriveOutcome` against its real
 * `game_finalised` event — the exact same call `keeper/resolver.ts`
 * itself makes), betting the presenter wallet on the side that already,
 * historically won, waiting for the demo-override kickoff to elapse, and
 * then resolving it through the real keeper backfill path
 * (`keeper/resolver.ts#resolveFixture`) same as everywhere else in this
 * project. The only fabricated part is *when* kickoff was — same
 * documented demo-only escape hatch `scripts/sync-markets.ts`'s
 * `kickoffOverrideTs` already establishes.
 */
import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type pino from "pino";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import { deriveMarket } from "@/lib/solana/pda";
import { claimWinnings, getProgram, getReadOnlyProgram, placeBet, BET_ACCOUNT_IDL_NAME, MARKET_ACCOUNT_IDL_NAME } from "@/lib/solana/program";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import { truncateToBytes, fetchTournamentFixtures } from "@/scripts/sync-markets";
import { buildKeeperContext } from "@/keeper/context";
import { resolveFixture } from "@/keeper/resolver";
import { getScores } from "@/lib/txline/client";
import { deriveOutcome, toFixture, toScoreEvent } from "@/lib/txline/normalize";
import { isKnockoutStage } from "@/lib/market";
import { explorerAddressUrl } from "@/lib/explorer";
import { formatUsdc } from "@/lib/format";
import type { FixtureStage, Outcome } from "@/lib/types";
import { loadDemoState, saveDemoState, type DemoState } from "@/scripts/demoState";

/** Same `WalletContextState` stand-in every other seeding script in this
 * repo uses (`scripts/seed-bets.ts`, `scripts/bet-e2e.ts`) — a real
 * `Keypair` satisfying just enough of the interface for
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Long enough for `place_bet`'s tx to land before kickoff, short enough
 * that a demo presenter isn't kept waiting. */
const KICKOFF_BUFFER_SECONDS = 30;
const KICKOFF_WAIT_MS = 35_000;
const FRESH_WIN_BET_USDC = 5;

interface FreshCandidate {
  fixtureId: number;
  home: string;
  away: string;
  stage: FixtureStage;
  outcome: Outcome;
}

/**
 * Scans TxLINE's real fixture list for one not already in `excludeIds`
 * (no market yet, per a live on-chain check) whose real result
 * `deriveOutcome` can cleanly determine — skips anything that throws
 * (the one documented gap: a tied-after-ET knockout fixture with no
 * penalty data — see `deriveOutcome`'s own doc comment) rather than
 * letting one bad fixture abort the whole search.
 */
async function pickFreshRealFixture(excludeIds: number[]): Promise<FreshCandidate> {
  const readOnly = await getReadOnlyProgram();
  const marketClient = (readOnly.account as any)[MARKET_ACCOUNT_IDL_NAME];
  const fixtures = await fetchTournamentFixtures();

  for (const raw of fixtures) {
    if (excludeIds.includes(raw.FixtureId)) continue;
    const fixture = toFixture(raw);
    if (!isKnockoutStage(fixture.stage)) continue;

    const [market] = deriveMarket(BigInt(raw.FixtureId));
    if (await marketClient.fetchNullable(market)) continue;

    let events;
    try {
      events = await getScores(raw.FixtureId);
    } catch {
      continue;
    }
    const finalEvent = events.find((e) => e.Action === "game_finalised");
    if (!finalEvent) continue;
    const scoreEvent = toScoreEvent(finalEvent);
    if (!scoreEvent) continue;

    let outcome: Outcome;
    try {
      outcome = deriveOutcome(scoreEvent, fixture.stage);
    } catch {
      continue; // e.g. tied-on-penalties-with-no-data — try the next candidate
    }

    return { fixtureId: raw.FixtureId, home: fixture.home, away: fixture.away, stage: fixture.stage, outcome };
  }

  throw new Error("no fresh, knockout-stage, not-yet-marketed real fixture left to fabricate a claimable win with");
}

/** `user` is `Bet`'s first field — right after the 8-byte Anchor
 * discriminator (see `state.rs`) — same offset
 * `lib/hooks/useMyBets.ts#BET_USER_OFFSET` already uses for exactly this
 * filter, kept in sync by inspection rather than importing a client-only
 * hook file into a script. */
const BET_USER_OFFSET = 8;

interface DiscoveredWin {
  fixtureId: number;
  outcome: Outcome;
  market: PublicKey;
  amount: bigint;
}

/**
 * Every real, on-chain, unclaimed winning `Bet` for `wallet` — discovered
 * directly via `getProgramAccounts`' `memcmp` filter on `user`, not a
 * hardcoded fixture list. A hardcoded candidate list is exactly what an
 * earlier version of this function used, and it silently missed genuine
 * pre-existing wins from unrelated earlier sessions (a real gap, found
 * live in the browser this session, not theoretical — the presenter
 * wallet already held unclaimed wins on fixtures this module had never
 * heard of). This is the same discovery approach
 * `lib/hooks/useMyBets.ts` uses to render `/portfolio` itself, so
 * "what does this function think is claimable" and "what the UI shows
 * as claimable" can't drift apart.
 */
async function findAllClaimableWins(wallet: PublicKey): Promise<DiscoveredWin[]> {
  const readOnly = await getReadOnlyProgram();
  const marketClient = (readOnly.account as any)[MARKET_ACCOUNT_IDL_NAME];
  const betClient = (readOnly.account as any)[BET_ACCOUNT_IDL_NAME];

  const bets = await betClient.all([{ memcmp: { offset: BET_USER_OFFSET, bytes: wallet.toBase58() } }]);

  const wins: DiscoveredWin[] = [];
  for (const { account: bet } of bets) {
    if (bet.claimed || bet.amount.toNumber() === 0) continue;
    const marketAccount = await marketClient.fetchNullable(bet.market as PublicKey);
    if (!marketAccount || Object.keys(marketAccount.status)[0] !== "resolved") continue;
    if (marketAccount.outcome !== bet.outcome) continue; // this bet lost

    wins.push({
      fixtureId: (marketAccount.fixtureId as anchor.BN).toNumber(),
      outcome: bet.outcome as Outcome,
      market: bet.market as PublicKey,
      amount: BigInt(bet.amount.toString()),
    });
  }
  return wins;
}

/** Claims `fixtureId`'s winning bet away immediately — used to enforce
 * "exactly one outstanding," never exposed through the UI (see
 * `lib/solana/program.ts#claimWinnings`'s own doc comment). */
async function claimAway(connection: Connection, devWallet: Keypair, fixtureId: number, outcome: Outcome): Promise<void> {
  const wallet = keypairWallet(devWallet);
  const program = await getProgram(connection, wallet);
  const tx = await claimWinnings(program, { fixtureId: BigInt(fixtureId), outcome });
  const signature = await sendAndConfirm(connection, wallet, tx, { label: `claiming extra win on fixture ${fixtureId}` });
  console.log(`  fixture ${fixtureId}: extra claimable win — claimed away (${signature})`);
}

/**
 * The one function both `seed-demo.ts` and `reset-demo.ts` call. Directly
 * discovers every unclaimed winning bet the presenter wallet holds
 * on-chain (`findAllClaimableWins` — not a hardcoded fixture list, see
 * its own doc comment). If none exists, fabricates one from scratch (see
 * module doc comment). If more than one exists, keeps the first and
 * claims the rest away. Always returns with exactly one outstanding, and
 * persists the result to `.demo-state.json`. `knownFixtureIds` is only
 * used to widen the exclusion list `pickFreshRealFixture` avoids when
 * fabricating a new win — it never limits *discovery*.
 */
export async function ensureExactlyOneClaimableWin(
  connection: Connection,
  devWallet: Keypair,
  logger: pino.Logger,
  knownFixtureIds: number[] = [],
): Promise<DemoState> {
  const priorState = loadDemoState();
  const candidateIds = Array.from(new Set([...(priorState?.usedRealFixtureIds ?? []), ...knownFixtureIds]));

  console.log(`\n--- discovering every claimable win the presenter wallet actually holds on-chain ---`);
  const wins = await findAllClaimableWins(devWallet.publicKey);
  for (const w of wins) candidateIds.push(w.fixtureId);

  if (wins.length === 0) {
    console.log(`no existing claimable win found — fabricating one from a fresh real fixture`);
    const picked = await pickFreshRealFixture(candidateIds);
    console.log(
      `picked fixture ${picked.fixtureId} (${picked.home} v ${picked.away}, ${picked.stage}) — real result: outcome ${picked.outcome}`,
    );

    const usdcMint = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const kickoffTs = Math.floor(Date.now() / 1000) + KICKOFF_BUFFER_SECONDS;
    const [market] = deriveMarket(BigInt(picked.fixtureId));
    const vault = getAssociatedTokenAddressSync(usdcMint, market, true);

    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(devWallet), { commitment: "confirmed" });
    const verifibetIdl = (await import("@/lib/solana/idl/verifibet.json")).default;
    const devProgram = new anchor.Program(
      { ...(verifibetIdl as anchor.Idl), address: (await import("@/lib/solana/pda")).PROGRAM_ID.toBase58() },
      provider,
    );

    const initTx = await devProgram.methods
      .initializeMarket(new BN(picked.fixtureId), truncateToBytes(picked.home, 24), truncateToBytes(picked.away, 24), new BN(kickoffTs))
      .accountsStrict({
        authority: devWallet.publicKey,
        market,
        usdcMint,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();
    initTx.feePayer = devWallet.publicKey;
    await anchor.web3.sendAndConfirmTransaction(connection, initTx, [devWallet], { commitment: "confirmed" });
    console.log(`  market initialized (kickoff in ${KICKOFF_BUFFER_SECONDS}s) — ${market.toBase58()}`);

    const wallet = keypairWallet(devWallet);
    const betProgram = await getProgram(connection, wallet);
    const betTx = await placeBet(betProgram, {
      fixtureId: BigInt(picked.fixtureId),
      outcome: picked.outcome,
      amountBaseUnits: BigInt(FRESH_WIN_BET_USDC * 1_000_000),
    });
    await sendAndConfirm(connection, wallet, betTx, { label: `presenter betting on the eventual winner` });
    console.log(`  presenter bet ${FRESH_WIN_BET_USDC} USDC on outcome ${picked.outcome}`);

    console.log(`  waiting ${KICKOFF_WAIT_MS / 1000}s for kickoff to pass...`);
    await sleep(KICKOFF_WAIT_MS);

    const ctx = await buildKeeperContext(logger);
    const result = await resolveFixture(ctx, picked.fixtureId, logger);
    if (result.action !== "resolved") {
      throw new Error(`expected fixture ${picked.fixtureId} to resolve, got "${result.action}"`);
    }
    console.log(`  resolved — outcome ${result.outcome} — ${result.explorerUrl}`);

    wins.push({ fixtureId: picked.fixtureId, outcome: picked.outcome, market, amount: BigInt(FRESH_WIN_BET_USDC * 1_000_000) });
    candidateIds.push(picked.fixtureId);
  }

  const [keep, ...extra] = wins;
  for (const w of extra) {
    await claimAway(connection, devWallet, w.fixtureId, w.outcome);
  }

  const state: DemoState = {
    designatedWin: { fixtureId: keep.fixtureId, outcome: keep.outcome, market: keep.market.toBase58() },
    usedRealFixtureIds: Array.from(new Set(candidateIds)),
  };
  saveDemoState(state);

  console.log(
    `\nclaimable win armed: fixture ${keep.fixtureId}, ${formatUsdc(keep.amount)} USDC on outcome ${keep.outcome}, ` +
      `market ${keep.market.toBase58()} (${explorerAddressUrl(keep.market.toBase58())})`,
  );
  return state;
}

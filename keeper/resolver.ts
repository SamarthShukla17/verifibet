/**
 * The moment of truth: takes a `FINISHED` fixture from "TxLINE says this
 * happened" to "VERIFIBET's `Market` account says so too, provably." Used
 * both as a library function (`keeper/index.ts`'s retry queue calls
 * `resolveFixture` for every `resolveMarket` job) and as a standalone CLI
 * backfill (`pnpm keeper:resolve --fixture <id>`) for resolving a specific
 * fixture on demand — a keeper restart missing a window, or a market that
 * needs resolving right now rather than waiting for the next reconcile
 * tick.
 *
 * ## Pipeline (mirrors the six lettered requirements this was speced against)
 *
 * (a) `pollUntilStableFinished` — TxLINE's scores stream is exactly that,
 *     a stream; a single `game_finalised` frame is not by itself proof the
 *     result is final and won't be corrected (VAR reversal, a feed
 *     correction, a reconnect replaying a stale frame). Requires the same
 *     `FINISHED` status on two consecutive polls, `POLL_INTERVAL_MS` apart,
 *     before trusting it.
 * (b) `deriveOutcome` (`lib/txline/normalize.ts`) is called exactly once,
 *     here, and its result is used verbatim everywhere below — this module
 *     never recomputes an outcome from anything else (see the cross-check
 *     below, which uses the proof's implied outcome only to *validate*
 *     `deriveOutcome`'s result, never to replace it).
 * (c) `fetchProof` (`lib/txline/proofs.ts`) for the Merkle-proof material
 *     `resolve_market`'s CPI needs.
 * (d) Builds `resolve_market` with every account/arg exactly as the IDL
 *     declares it (see `anchor/programs/verifibet/src/instructions/resolve_market.rs`'s
 *     module doc comment and `anchor/tests/verifibet.ts`'s own
 *     `resolveMarket` helper, which this mirrors against a real deploy).
 * (e) Compute budget (600k CU — this instruction does a Merkle-proof CPI,
 *     well above the 200k default) + a real median priority fee, a hard
 *     ≤1232-byte legacy-transaction-size assertion, then send + confirm.
 * (f) Re-reads `market.outcome` on-chain after confirmation and asserts it
 *     matches what was submitted — the one check that would catch a
 *     landed-but-wrong transaction (shouldn't be possible given `resolve_market`'s
 *     own on-chain logic, but this is the moment of truth, not the moment
 *     to assume).
 *
 * ## A real gap this module found, not invented: penalty shootouts
 *
 * `resolve_market`'s CPI only ever proves an FT+ET goal *difference* — its
 * `stat_a`/`stat_b` are always the two teams' goal counts, `op` is always
 * `Subtract` (see `resolve_market.rs`). There is no on-chain representation
 * of a penalty-shootout score anywhere in this design. For a knockout match
 * `deriveOutcome` decides on penalties (FT+ET tied), the proof's own
 * implied outcome is always 1 (draw) — submitting `deriveOutcome`'s real
 * answer (0 or 2) would make `resolve_market`'s own predicate check fail
 * on-chain; submitting 1 to match what's provable would misrepresent who
 * actually advanced. Neither is acceptable, so this is caught client-side
 * (`proofImpliedOutcome !== outcome` below) and treated as a CPI validation
 * failure — logged loudly and alerted, never silently resolved either way.
 * This is a real architectural limitation to flag, not a bug to route
 * around.
 */
import { existsSync } from "node:fs";
import { AnchorError, BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";
import type pino from "pino";

import { CONFIG } from "@/lib/config";
import { explorerTxUrl } from "@/lib/explorer";
import { deriveMarket } from "@/lib/solana/pda";
import { MARKET_ACCOUNT_IDL_NAME } from "@/lib/solana/program";
import { getScores } from "@/lib/txline/client";
import { deriveOutcome, fixtureStatusFromActionAndStatusId, isForwardStatusTransition, toFixture, toScoreEvent } from "@/lib/txline/normalize";
import { fetchProof } from "@/lib/txline/proofs";
import type { TxScore } from "@/lib/txline/types";
import type { FixtureStatus, Outcome } from "@/lib/types";
import { buildKeeperContext } from "@/keeper/context";
import { telegramAlert } from "@/keeper/alerts";
import { dailyScoresRootsPda, fetchMarketStatus, formatTxError, type KeeperContext } from "@/keeper/jobs";
import { buildLogger } from "@/keeper/logger";
import { fetchTournamentFixtures } from "@/scripts/sync-markets";

const POLL_INTERVAL_MS = 5_000;
/** 8 attempts = 35s worst case before giving up and letting the outer
 * retry queue's own 30s->2m->10m backoff take over — this poll is a quick
 * double-check plus headroom for a transient `getScores` network hiccup,
 * not where a long wait for the match to actually finish should happen
 * (the caller only enqueues this once TxLINE already reported FINISHED
 * once). */
const MAX_POLL_ATTEMPTS = 8;

const COMPUTE_UNIT_LIMIT = 600_000;
/** Legacy Solana transaction wire-size limit (IPv6 MTU derived) —
 * `resolve_market`'s Merkle proofs are the one place in this program a
 * transaction could plausibly get close to it. */
const MAX_TX_BYTES = 1232;

/** Thrown by `fetchProof` when TxLINE hasn't published a `game_finalised`
 * stat-validation proof yet — a "not ready, try again" condition, not a
 * real failure. Never alerts Telegram; the retry queue's backoff is the
 * entire handling for this case. */
export class ProofNotPublishedError extends Error {}

/**
 * Either the client-side proof/outcome cross-check failed (see this
 * module's doc comment on penalty shootouts) or `resolve_market`'s own
 * on-chain `InvalidStatProof` guard rejected the submitted proof. Either
 * way: never retried with a different outcome, never silently downgraded
 * to whatever the proof *can* support — logged loudly and alerted so a
 * human decides what to do.
 */
export class CpiValidationFailureError extends Error {}

export class TxTooLargeError extends Error {
  constructor(
    readonly fixtureId: number,
    readonly bytes: number,
  ) {
    super(`resolve_market tx for fixture ${fixtureId} is ${bytes} bytes, over the ${MAX_TX_BYTES}-byte legacy tx limit`);
    this.name = "TxTooLargeError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latestBySeq(events: TxScore[]): TxScore | undefined {
  return events.length === 0 ? undefined : events.reduce((a, b) => (b.Seq > a.Seq ? b : a));
}

/**
 * Folds through every event in `Seq` order applying the same
 * forward-only guard `lib/txline/statusTracker.ts#transitionTo` and
 * `components/match/MatchDetailBoard.tsx`'s live-status effect already
 * use (`isForwardStatusTransition`, see its own doc comment) — a real
 * mid-or-post-match event with no `StatusId` (`suspend`, `comment`,
 * `disconnected`, ...) can't bounce the derived status backward. Reading
 * only the single highest-`Seq` event (as an earlier version of this
 * function did) is a real bug, not a theoretical one: confirmed live
 * against fixture 18175983, whose real feed emits a `disconnected` event
 * (no `StatusId`) *after* its `game_finalised` event — the naive
 * "latest event's own status" check reads that as `SCHEDULED` forever,
 * so `pollUntilStableFinished` never recognizes a fixture that has
 * genuinely, stably finished.
 */
export function deriveStableStatus(events: TxScore[]): FixtureStatus {
  const sorted = [...events].sort((a, b) => a.Seq - b.Seq);
  let status: FixtureStatus = "SCHEDULED";
  for (const event of sorted) {
    const next = fixtureStatusFromActionAndStatusId(event.Action, event.StatusId);
    if (isForwardStatusTransition(status, next)) status = next;
  }
  return status;
}

/** (a) — see module doc comment. Returns the stable `game_finalised`
 * event once two consecutive polls both report `FINISHED`. A single failed
 * `getScores` call (network hiccup — `lib/txline/client.ts`'s own 3x
 * internal retry already exhausted) is treated as inconclusive, not as a
 * flicker away from FINISHED: it neither advances nor resets the
 * stability counter, just costs one attempt and retries. */
async function pollUntilStableFinished(fixtureId: number, logger: pino.Logger): Promise<TxScore> {
  let consecutiveFinished = 0;

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    let events: TxScore[];
    try {
      events = await getScores(fixtureId);
    } catch (err) {
      // `progress: true` marks this (and the two log calls below) as
      // poll-loop chatter, not a completed job attempt — app/api/keeper/logs
      // filters on it structurally rather than matching message strings,
      // so the dashboard's recent-actions table shows one row per real
      // job outcome, not one per 5s poll tick.
      logger.warn(
        { job: "resolveMarket", fixtureId, attempt, progress: true, error: err instanceof Error ? err.message : String(err) },
        "getScores poll failed, retrying",
      );
      if (attempt < MAX_POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const finalised = events.filter((e) => e.Action === "game_finalised");
    const status = deriveStableStatus(events);

    if (status === "FINISHED" && finalised.length > 0) {
      consecutiveFinished += 1;
      logger.info(
        { job: "resolveMarket", fixtureId, attempt, consecutiveFinished, progress: true },
        "fixture reports FINISHED",
      );
      if (consecutiveFinished >= 2) return latestBySeq(finalised)!;
    } else {
      if (consecutiveFinished > 0) {
        logger.warn(
          { job: "resolveMarket", fixtureId, attempt, progress: true },
          "fixture flickered away from FINISHED mid-poll — resetting stability counter",
        );
      }
      consecutiveFinished = 0;
    }

    if (attempt < MAX_POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `fixture ${fixtureId} did not report a stable FINISHED status after ${MAX_POLL_ATTEMPTS} polls ` +
      `(~${Math.round(((MAX_POLL_ATTEMPTS - 1) * POLL_INTERVAL_MS) / 1000)}s)`,
  );
}

/** Real per-slot congestion data, not a guess — falls back to 0 (no extra
 * priority) only when the RPC genuinely has nothing recent for this
 * account, which devnet often doesn't. */
async function medianPriorityFee(connection: Connection, market: PublicKey): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: [market] });
  if (fees.length === 0) return 0;
  const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function tryParseAnchorError(err: unknown): AnchorError | null {
  if (err instanceof AnchorError) return err;
  const logs = (err as { logs?: string[] })?.logs;
  if (!logs) return null;
  try {
    return AnchorError.parse(logs);
  } catch {
    return null;
  }
}

function receiptUrl(fixtureId: number): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/receipts/${fixtureId}`;
}

/**
 * Failure taxonomy (requirement 2): classifies whatever `resolveFixtureInner`
 * threw and logs/alerts accordingly, then lets the original error propagate
 * unchanged — the caller (`keeper/index.ts`'s retry queue, or this file's
 * own CLI `main`) still decides what happens next (backoff, exit code).
 * This function only ever adds signal, never swallows or reshapes.
 */
async function handleFailure(logger: pino.Logger, fixtureId: number, err: unknown): Promise<void> {
  if (err instanceof ProofNotPublishedError) {
    logger.warn({ job: "resolveMarket", fixtureId, error: err.message }, "proof not yet published — will retry later");
    return;
  }

  if (err instanceof TxTooLargeError) {
    logger.error({ job: "resolveMarket", fixtureId, bytes: err.bytes }, "resolve_market tx exceeds the legacy size limit");
    await telegramAlert(
      logger,
      `VERIFIBET fixture ${fixtureId}: resolve_market tx is ${err.bytes} bytes (limit ${MAX_TX_BYTES}). ` +
        `Merkle proof too deep for one legacy transaction — check the TxLINE IDL for a proof-account/chunked ` +
        `pattern. Needs a fix today.`,
    );
    return;
  }

  if (err instanceof CpiValidationFailureError) {
    logger.error(
      { job: "resolveMarket", fixtureId, error: err.message },
      "CPI VALIDATION FAILURE — never overriding, needs human review",
    );
    await telegramAlert(
      logger,
      `VERIFIBET fixture ${fixtureId}: resolve_market validation failed — ${err.message}. NOT overridden. Needs manual review.`,
    );
    return;
  }

  const anchorErr = tryParseAnchorError(err);
  if (anchorErr?.error.errorCode.code === "InvalidStatProof") {
    logger.error(
      { job: "resolveMarket", fixtureId, error: formatTxError(err) },
      "CPI VALIDATION FAILURE (on-chain InvalidStatProof) — never overriding, needs human review",
    );
    await telegramAlert(
      logger,
      `VERIFIBET fixture ${fixtureId}: resolve_market rejected on-chain with InvalidStatProof. NOT overridden. Needs manual review.`,
    );
    return;
  }

  if (err instanceof SendTransactionError) {
    logger.error(
      { job: "resolveMarket", fixtureId, error: err.message, logs: err.logs ?? [] },
      "simulation failure — full logs dumped",
    );
    return;
  }

  // Anything else (e.g. "market for fixture N does not exist on-chain
  // yet") is left unlogged here deliberately — the caller (keeper/index.ts's
  // retry-queue runner, or this file's own CLI `main`) already logs every
  // thrown error generically. Logging it again here too would just be the
  // same failure appearing twice in the dashboard's recent-actions table
  // (once "Failed" from this function, once "Retrying" from the queue) for
  // one real event.
}

export interface ResolveResult {
  action: "resolved" | "skipped" | "dry_run";
  status?: string;
  outcome?: Outcome;
  txSig?: string;
  explorerUrl?: string;
  receiptUrl?: string;
  txBytes?: number;
}

async function resolveFixtureInner(
  ctx: KeeperContext,
  fixtureId: number,
  logger: pino.Logger,
): Promise<ResolveResult> {
  const [market] = deriveMarket(BigInt(fixtureId));
  const status = await fetchMarketStatus(ctx.program, market);

  if (status === null) {
    throw new Error(`market for fixture ${fixtureId} does not exist on-chain yet`);
  }
  if (status !== "open" && status !== "locked") {
    return { action: "skipped", status };
  }

  // (a)
  const finalEvent = await pollUntilStableFinished(fixtureId, logger);

  // Stage lookup — deriveOutcome's group-vs-knockout branch needs it, and
  // Market itself carries no stage field to read this back from later.
  const [txFixture] = await fetchTournamentFixtures(fixtureId);
  if (!txFixture) {
    throw new Error(`fixture ${fixtureId} not found in TxLINE's fixture snapshot — cannot determine stage`);
  }
  const stage = toFixture(txFixture).stage;

  // (b) — the ONE call to deriveOutcome; its result is used verbatim below.
  const scoreEvent = toScoreEvent(finalEvent);
  if (!scoreEvent) {
    throw new Error(`fixture ${fixtureId}'s stable game_finalised event carries no Score data`);
  }
  const outcome = deriveOutcome(scoreEvent, stage);

  // (c)
  let proof;
  try {
    proof = await fetchProof(fixtureId, "FT_RESULT");
  } catch (err) {
    throw new ProofNotPublishedError(err instanceof Error ? err.message : String(err));
  }
  const raw = proof.meta.raw;
  if (!raw.statToProve2 || !raw.statProof2) {
    throw new ProofNotPublishedError(`fixture ${fixtureId} proof is missing the away-team stat term`);
  }

  // Cross-check only — see module doc comment's penalty-shootout section.
  // `outcome` (deriveOutcome's result) is what gets submitted either way.
  const proofImpliedOutcome: Outcome = proof.value > 0 ? 0 : proof.value === 0 ? 1 : 2;
  if (proofImpliedOutcome !== outcome) {
    throw new CpiValidationFailureError(
      `fixture ${fixtureId}: deriveOutcome (scores-stream, stage ${stage}) says outcome ${outcome}, but the ` +
        `TxLINE Merkle-proof's FT+ET goal difference (${proof.value}) only supports outcome ${proofImpliedOutcome} ` +
        `— resolve_market has no on-chain proof of a penalty-shootout result, so this claim cannot be submitted honestly`,
    );
  }

  // (d)
  const fixtureSummary = {
    fixtureId: new BN(raw.summary.fixtureId),
    updateStats: {
      updateCount: raw.summary.updateStats.updateCount,
      minTimestamp: new BN(raw.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(raw.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: raw.summary.eventStatsSubTreeRoot,
  };
  const statHome = { statToProve: raw.statToProve, eventStatRoot: raw.eventStatRoot, statProof: raw.statProof };
  const statAway = { statToProve: raw.statToProve2, eventStatRoot: raw.eventStatRoot, statProof: raw.statProof2 };

  const txlineProgramId = new PublicKey(CONFIG.devnet.txlineProgramId);
  const dailyScoresMerkleRoots = dailyScoresRootsPda(raw.ts, txlineProgramId);

  const resolveIx = await ctx.program.methods
    .resolveMarket(outcome, new BN(raw.ts), fixtureSummary, raw.subTreeProof, raw.mainTreeProof, statHome, statAway)
    .accountsStrict({
      authority: ctx.keeper.publicKey,
      market,
      txlineProgram: txlineProgramId,
      dailyScoresMerkleRoots,
    })
    .instruction();

  // (e)
  const priorityFee = await medianPriorityFee(ctx.connection, market);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    resolveIx,
  );
  const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = ctx.keeper.publicKey;
  tx.sign(ctx.keeper);

  const wireBytes = tx.serialize().length;
  if (wireBytes > MAX_TX_BYTES) {
    throw new TxTooLargeError(fixtureId, wireBytes);
  }

  const dryRun = process.env.KEEPER_DRY_RUN === "1";
  if (dryRun) {
    logger.info(
      {
        job: "resolveMarket",
        fixtureId,
        dryRun: true,
        outcome,
        priorityFeeMicroLamports: priorityFee,
        txBytes: wireBytes,
        base64: tx.serialize().toString("base64"),
      },
      "KEEPER_DRY_RUN — resolve_market built and signed, not sent",
    );
    return { action: "dry_run", outcome, txBytes: wireBytes };
  }

  let txSig: string;
  try {
    txSig = await ctx.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await ctx.connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
  } catch (err) {
    const anchorErr = tryParseAnchorError(err);
    if (anchorErr?.error.errorCode.code === "InvalidStatProof") {
      throw new CpiValidationFailureError(
        `fixture ${fixtureId}: resolve_market rejected the submitted proof on-chain (InvalidStatProof) — ${formatTxError(err)}`,
      );
    }
    throw err;
  }

  // (f)
  const marketClient = (ctx.program.account as Record<string, { fetch(addr: PublicKey): Promise<{ outcome: number }> }>)[
    MARKET_ACCOUNT_IDL_NAME
  ];
  const decoded = await marketClient.fetch(market);
  if (decoded.outcome !== outcome) {
    throw new Error(
      `fixture ${fixtureId}: on-chain market.outcome (${decoded.outcome}) does not match the submitted outcome ` +
        `(${outcome}) after a confirmed resolve_market tx ${txSig} — this should be impossible`,
    );
  }

  return {
    action: "resolved",
    status,
    outcome,
    txSig,
    explorerUrl: explorerTxUrl(txSig),
    receiptUrl: receiptUrl(fixtureId),
  };
}

/**
 * Public entry point — runs the pipeline, and on any failure classifies +
 * logs + (when warranted) Telegram-alerts via `handleFailure` before
 * rethrowing unchanged. Callers (the retry queue, the CLI below) always
 * see the original error; this only adds logging/alerting on the way past.
 */
export async function resolveFixture(
  ctx: KeeperContext,
  fixtureId: number,
  logger: pino.Logger,
): Promise<ResolveResult> {
  try {
    return await resolveFixtureInner(ctx, fixtureId, logger);
  } catch (err) {
    await handleFailure(logger, fixtureId, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI backfill: pnpm keeper:resolve --fixture <id>  (KEEPER_DRY_RUN=1 to preview)
// ---------------------------------------------------------------------------

function parseFixtureArg(argv: string[]): number {
  const idx = argv.indexOf("--fixture");
  if (idx === -1 || argv[idx + 1] === undefined) {
    throw new Error("usage: pnpm keeper:resolve --fixture <fixtureId>");
  }
  const fixtureId = Number(argv[idx + 1]);
  if (!Number.isInteger(fixtureId)) {
    throw new Error(`--fixture must be an integer, got "${argv[idx + 1]}"`);
  }
  return fixtureId;
}

async function main() {
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  const logger = buildLogger();
  const fixtureId = parseFixtureArg(process.argv.slice(2));
  const dryRun = process.env.KEEPER_DRY_RUN === "1";

  const ctx = await buildKeeperContext(logger);
  logger.info({ fixtureId, dryRun }, "keeper:resolve backfill starting");

  const result = await resolveFixture(ctx, fixtureId, logger);
  logger.info({ job: "resolveMarket", fixtureId, ...result }, `resolveMarket ${result.action}`);

  if (result.action === "resolved") {
    console.log(`\nresolved fixture ${fixtureId} — outcome ${result.outcome}`);
    console.log(`tx:      ${result.explorerUrl}`);
    console.log(`receipt: ${result.receiptUrl}`);
  } else if (result.action === "dry_run") {
    console.log(`\nKEEPER_DRY_RUN — fixture ${fixtureId} would resolve with outcome ${result.outcome} (${result.txBytes} bytes)`);
  } else {
    console.log(`\nfixture ${fixtureId} skipped — market status is already "${result.status}"`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

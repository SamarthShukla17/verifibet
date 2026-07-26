/**
 * Assembles a `Receipt` (see `lib/types.ts`) entirely from on-chain +
 * TxLINE-proof sources — the shareable, independently-checkable artifact
 * a bettor gets once a market resolves. Server-only (does real RPC and
 * TxLINE calls) by the same convention as the rest of this app.
 *
 * Every field traces to one of exactly three sources, no in-between
 * derivation this module invents on its own:
 *
 * 1. The on-chain `Market` account itself (`getAccountInfo` + Anchor's
 *    account coder — not the higher-level `program.account.<x>.fetch()`,
 *    per this task's explicit instruction, so a missing account is a
 *    plain `null` this module handles directly rather than `fetchNullable`
 *    doing it implicitly): `home`/`away`, `outcome`, `kickoffTs`,
 *    `pools`/`totalPool`, `resolvedAt`, `status` (to gate whether a
 *    receipt can exist at all).
 * 2. The resolve transaction's own signature, found via
 *    `getSignaturesForAddress` on the market account, scanning
 *    newest-first for the one whose logs contain
 *    `"Instruction: ResolveMarket"` (Anchor's own dispatch macro emits
 *    this log line unconditionally — a reliable signal without needing
 *    to decode every instruction in every transaction).
 * 3. The stored TxLINE proof (`lib/txline/proofs.ts#fetchProof` — reads
 *    through the same Redis/disk persistence the keeper uses, so this
 *    doesn't force a fresh TxLINE fetch if one's already cached) for
 *    `finalScore` and the `leaf`/`path`/`root` triple `verifiedLocally`
 *    is computed from via `lib/txline/verify.ts#verifyProof` — genuinely
 *    recomputed here, not read back from anywhere that could be lying
 *    about it.
 *
 * `betAmount`/`payout` are deliberately omitted (left `undefined`, which
 * `JSON.stringify` drops cleanly) — this is a market-level receipt, not
 * tied to any specific bettor's `Bet` account, so there's no single
 * amount/payout to report. `Receipt`'s bigint fields would need a
 * `JSON.stringify` replacer if a future per-user receipt ever populates
 * them (`JSON.stringify` throws on a bare `bigint`) — not needed here
 * since this module never sets them.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { explorerTxUrl } from "@/lib/explorer";
import { deriveMarket } from "@/lib/solana/pda";
import { MARKET_ACCOUNT_IDL_NAME } from "@/lib/solana/program";
import { fetchProof } from "@/lib/txline/proofs";
import { verifyProof } from "@/lib/txline/verify";
import { demoProofHash, findScenarioByDemoFixtureId, isDemoFixtureId } from "@/lib/txline/demoScenarios";
import { toScoreEvent } from "@/lib/txline/normalize";
import type { Outcome, Receipt } from "@/lib/types";

// Same quirk documented in scripts/devnet-e2e.ts and
// anchor/tests/verifibet.ts, one layer deeper: `program.coder.accounts`
// is built from `program.idl` (Anchor's *post-processed* copy), not the
// raw `verifibet.json` this file imports — and `Program`'s constructor
// camelCases each `::`-separated segment of every account name
// independently ("verifibet::state::Market" -> "verifibet::state::market",
// only the last segment's leading letter changes). Confirmed empirically
// against a real devnet account, not assumed: `coder.accounts.decode`
// with the raw JSON's exact "verifibet::state::Market" throws "Account
// not found" even though that string is right there in `idl.accounts` —
// it just isn't the string the coder was actually built to look up.
// (See lib/solana/program.ts, the shared constant this re-exports from.)

/** How many of the market's most recent signatures to scan for the
 * resolve transaction — generous for a real market's actual lifecycle
 * (init, a handful of bets/locks, one resolve), scanned newest-first so
 * the (typically late-lifecycle) resolve is found in the first few
 * anyway; not an attempt to be clever about the exact right number. */
const RESOLVE_SIGNATURE_SCAN_LIMIT = 200;

export type ReceiptNotAvailableReason = "no_market" | "not_resolved";

export class ReceiptNotAvailableError extends Error {
  readonly reason: ReceiptNotAvailableReason;
  constructor(reason: ReceiptNotAvailableReason, message: string) {
    super(message);
    this.name = "ReceiptNotAvailableError";
    this.reason = reason;
  }
}

async function findResolveTxSignature(
  connection: Connection,
  market: PublicKey,
  fixtureId: number,
): Promise<string> {
  const signatures = await connection.getSignaturesForAddress(market, {
    limit: RESOLVE_SIGNATURE_SCAN_LIMIT,
  });

  for (const sigInfo of signatures) {
    const tx = await connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages ?? [];
    if (logs.some((line) => line.includes("Instruction: ResolveMarket"))) {
      return sigInfo.signature;
    }
  }

  throw new ReceiptNotAvailableError(
    "not_resolved",
    `market for fixture ${fixtureId} has status Resolved on-chain, but no resolve_market ` +
      `transaction was found in its last ${RESOLVE_SIGNATURE_SCAN_LIMIT} signatures — signature ` +
      `history may have been pruned, or this account was resolved by an instruction other than ` +
      `resolve_market`,
  );
}

/**
 * Builds the full `Receipt` for `fixtureId`, or throws
 * `ReceiptNotAvailableError` (`reason: "no_market"` | `"not_resolved"`)
 * if one can't exist yet — the route below turns that straight into a
 * 404 with a clear status message.
 */
export async function buildReceipt(
  connection: Connection,
  program: Program,
  fixtureId: number,
): Promise<Receipt> {
  const [market] = deriveMarket(BigInt(fixtureId));

  const accountInfo = await connection.getAccountInfo(market);
  if (!accountInfo) {
    throw new ReceiptNotAvailableError(
      "no_market",
      `no Market account exists yet for fixture ${fixtureId} (expected at ${market.toBase58()}) — ` +
        `it hasn't been synced (see scripts/sync-markets.ts)`,
    );
  }

  const decoded = program.coder.accounts.decode(MARKET_ACCOUNT_IDL_NAME, accountInfo.data) as {
    fixtureId: { toNumber(): number };
    home: string;
    away: string;
    status: Record<string, unknown>;
    outcome: number;
    kickoffTs: { toNumber(): number };
    pools: [{ toString(): string }, { toString(): string }, { toString(): string }];
    totalPool: { toString(): string };
    resolvedAt: { toNumber(): number };
  };

  // Defensive, not paranoid: the PDA derivation already guarantees this
  // structurally, but a decode succeeding says only "this is *a* valid
  // Market account", not "it's *this* fixture's" — cheap to check.
  if (decoded.fixtureId.toNumber() !== fixtureId) {
    throw new Error(
      `Market PDA for fixture ${fixtureId} decoded with fixtureId ${decoded.fixtureId.toNumber()} — PDA/account mismatch`,
    );
  }

  const statusName = Object.keys(decoded.status)[0];
  if (statusName !== "resolved") {
    throw new ReceiptNotAvailableError(
      "not_resolved",
      `market for fixture ${fixtureId} is ${statusName}, not yet resolved`,
    );
  }

  // Demo-range markets are never resolved through resolve_market's real
  // CPI (TxLINE has never heard of these fixture ids) — always through
  // resolve_market_attested instead (see keeper/demoResolver.ts). There is
  // no real TxLINE proof to fetch here; fetchProof(fixtureId) below would
  // just fail against a fixture id TxLINE doesn't know. Built honestly
  // from the same local scenario data + commitment hash the keeper itself
  // submitted on-chain — never fabricated to look like a real proof (see
  // Receipt.attested's own doc comment).
  if (isDemoFixtureId(fixtureId)) {
    const scenario = findScenarioByDemoFixtureId(fixtureId);
    if (!scenario) {
      throw new Error(`fixture ${fixtureId} is a demo-range id but no registered scenario claims it`);
    }
    const finalEvent = scenario.scores.find((e) => e.Action === "game_finalised");
    const scoreEvent = finalEvent ? toScoreEvent(finalEvent) : null;
    if (!scoreEvent) {
      throw new Error(`scenario "${scenario.meta.scenario}" has no game_finalised Score data — cannot build a receipt`);
    }

    const resolveTxSig = await findResolveTxSignature(connection, market, fixtureId);
    const commitment = demoProofHash(scenario.meta.scenario, fixtureId, decoded.outcome, scoreEvent.home, scoreEvent.away).toString(
      "hex",
    );

    return {
      fixtureId,
      teams: { home: decoded.home, away: decoded.away },
      finalScore: { home: scoreEvent.home, away: scoreEvent.away },
      outcome: decoded.outcome as Outcome,
      kickoffTs: decoded.kickoffTs.toNumber(),
      pools: [decoded.pools[0].toString(), decoded.pools[1].toString(), decoded.pools[2].toString()],
      totalPool: decoded.totalPool.toString(),
      resolveTxSig,
      explorerUrl: explorerTxUrl(resolveTxSig),
      // Leaf === root === the one local commitment — there's no real
      // Merkle chain to walk, so the "proof" is a single self-consistent
      // node, not a fabricated multi-level TxLINE-shaped one.
      proofRoot: commitment,
      proofLeaf: commitment,
      proofPath: [],
      verifiedLocally: true,
      resolvedAt: decoded.resolvedAt.toNumber(),
      attested: true,
    };
  }

  const [resolveTxSig, proof] = await Promise.all([
    findResolveTxSignature(connection, market, fixtureId),
    fetchProof(fixtureId),
  ]);

  const verifiedLocally = verifyProof(proof.leaf, proof.path, proof.root);

  return {
    fixtureId,
    teams: { home: decoded.home, away: decoded.away },
    finalScore: { home: proof.meta.home.value, away: proof.meta.away.value },
    outcome: decoded.outcome as Outcome,
    kickoffTs: decoded.kickoffTs.toNumber(),
    pools: [decoded.pools[0].toString(), decoded.pools[1].toString(), decoded.pools[2].toString()],
    totalPool: decoded.totalPool.toString(),
    resolveTxSig,
    explorerUrl: explorerTxUrl(resolveTxSig),
    proofRoot: proof.root,
    proofLeaf: proof.leaf,
    proofPath: proof.path,
    verifiedLocally,
    resolvedAt: decoded.resolvedAt.toNumber(),
  };
}

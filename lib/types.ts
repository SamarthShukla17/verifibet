/**
 * App-level domain types — the single source of truth for these shapes.
 * Import from here; don't redeclare Fixture/MarketStatus/Outcome/
 * OddsSnapshot/ScoreEvent/Receipt elsewhere.
 */

export type FixtureStage =
  | "GROUP"
  | "R32"
  | "R16"
  | "QF"
  | "SF"
  | "THIRD"
  | "FINAL";

export type FixtureStatus =
  | "SCHEDULED"
  | "LIVE"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED";

export interface Fixture {
  fixtureId: number;
  home: string;
  away: string;
  kickoffTs: number;
  stage: FixtureStage;
  status: FixtureStatus;
  group?: string;
}

export type MarketStatus = "OPEN" | "LOCKED" | "RESOLVED" | "VOIDED";

/**
 * 0 = home, 1 = draw, 2 = away. Must match the on-chain program's
 * resolved-outcome encoding exactly (see anchor state.rs once scaffolded).
 */
export type Outcome = 0 | 1 | 2;

export interface Score {
  home: number;
  away: number;
}

/**
 * Decimal odds + implied probabilities from TxLINE. This is display data,
 * not money — `number` here is intentional and does not violate the
 * bigint/never-floats convention, which applies to settlement amounts.
 */
export interface OddsSnapshot {
  fixtureId: number;
  home: number;
  draw: number;
  away: number;
  /**
   * The three raw TxLINE `Pct` values rescaled to sum to exactly 100 (the
   * "fair" probabilities with the bookmaker's margin removed) — see
   * `overroundPct`, which is the margin `impliedPct` divides out. Both are
   * derived from the same raw `Pct` array in `lib/txline/normalize.ts`, so
   * this is never silently lossy: `impliedPct[i] * (1 + overroundPct/100)
   * ≈` the original raw `Pct[i]`.
   */
  impliedPct: [number, number, number];
  /**
   * The bookmaker's overround as a percentage (raw `Pct` values summed
   * before normalization, minus 100) — e.g. `4.2` means the raw quoted
   * probabilities summed to 104.2%. Surfaced rather than silently
   * discarded during `impliedPct`'s normalization, so the UI can disclose
   * it honestly instead of implying TxLINE's odds are vig-free.
   */
  overroundPct: number;
  ts: number;
}

export interface ScoreEvent extends Score {
  fixtureId: number;
  minute?: number;
  status: FixtureStatus;
  /**
   * Penalty-shootout goals — present only once a shootout has happened.
   * `home`/`away` above are full-time + extra-time goals only (TxLINE's
   * `Total.Goals`, confirmed via `lib/txline/normalize.ts`'s golden
   * vectors to include ET but never `PE`) — shootout goals never count as
   * "goals" in the conventional sense, only as the knockout tiebreaker
   * `deriveOutcome` falls back to when `home === away`.
   */
  homePens?: number;
  awayPens?: number;
}

export interface Receipt {
  fixtureId: number;
  teams: { home: string; away: string };
  finalScore: Score;
  outcome: Outcome;
  /** USDC base units, 6dp. */
  betAmount?: bigint;
  /** USDC base units, 6dp. */
  payout?: bigint;
  resolveTxSig: string;
  explorerUrl: string;
  proofRoot: string;
  proofLeaf: string;
  /**
   * `{hash, isRightSibling}[]`, not plain hex strings — sidedness isn't
   * optional information for `lib/txline/verify.ts`'s `verifyProof` (a
   * sorted-pair rule that wouldn't need it was tried and empirically
   * rejected; see that module's doc comment). Matches
   * `lib/txline/verify.ts`'s `ProofStep` shape exactly — imported there
   * rather than redeclared, since `lib/types.ts` doesn't otherwise depend
   * on `lib/txline/*`; kept structural here (not a re-export) to avoid an
   * unusual reverse import for a types-only file.
   */
  proofPath: { hash: string; isRightSibling: boolean }[];
  verifiedLocally: boolean;
  resolvedAt: number;
}

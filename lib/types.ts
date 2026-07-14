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
  impliedPct: [number, number, number];
  ts: number;
}

export interface ScoreEvent extends Score {
  fixtureId: number;
  minute?: number;
  status: FixtureStatus;
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
  proofPath: string[];
  verifiedLocally: boolean;
  resolvedAt: number;
}

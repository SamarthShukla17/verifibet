/**
 * TxLINE payload shapes — field names copied from REAL responses captured
 * by `scripts/txline-smoke.ts` (see fixtures.sample.json, odds.sample.json,
 * scores.sample.json at repo root, and NOTES.md/CLAUDE.md for the raw
 * evidence). These are TxLINE's wire types, not VERIFIBET's domain types —
 * see `lib/types.ts` for `Fixture`/`OddsSnapshot`/`ScoreEvent`, which are
 * mapped from these.
 *
 * TxLINE's own OpenAPI spec (https://txline-dev.txodds.com/docs) disagrees
 * with the real payloads in two ways worth knowing about:
 * - The documented `Fixture` schema doesn't declare `GameState` at all, but
 *   it's present (as a number) on most real fixtures.
 * - The documented `Scores` schema types every field in camelCase
 *   (`fixtureId`, `gameState`, ...); the real payload is PascalCase
 *   throughout, matching Fixture/OddsPayload's convention instead.
 */

/** GET /api/fixtures/snapshot — one array entry. */
export interface TxFixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
  /**
   * Not in TxLINE's documented `Fixture` schema at all, but present (as a
   * number, not a string) on most real fixtures. Empirically: `1` on
   * fixtures documentation/examples/troubleshooting.mdx calls "scheduled",
   * `3` observed on already-decided fixtures. Absent on some far-future
   * fixtures that haven't been assigned a state yet.
   */
  GameState?: number;
}

/** GET /api/odds/snapshot/{fixtureId} — one array entry (one market line). */
export interface TxOdds {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  /**
   * `string` per TxLINE's OpenAPI `OddsPayload` schema; observed as `null`
   * in practice on every pre-match market line captured so far.
   */
  GameState: string | null;
  InRunning: boolean;
  MarketParameters: string;
  MarketPeriod: string;
  PriceNames: string[];
  /** Integer-scaled decimal odds, e.g. `1953` = 1.953. */
  Prices: number[];
  /**
   * Either `"NA"` or a string formatted to exactly 3dp (e.g. `"52.632"`) —
   * per TxLINE's own documented pattern `^(NA|\d+\.\d{3})$`. Deliberately
   * `string`, not `number`.
   */
  Pct: string[];
}

/**
 * GET /api/scores/snapshot/{fixtureId} — one array entry (one score event).
 * TxLINE's `Scores` schema is a single object shared across soccer,
 * basketball, and US football, with ~30 sport/action-specific optional
 * fields on top of a common envelope; a real fixture's snapshot can contain
 * 40+ distinct `Action` values (`comment`, `goal`, `substitution`,
 * `lineups`, `var`, `game_finalised`, ...), each populating a different
 * subset. Only the fields present on every observed entry are typed
 * precisely below; the rest are typed loosely rather than reproducing
 * TxLINE's full per-sport/per-action taxonomy for a hackathon integration —
 * widen individual fields here if a specific `Action` needs to be handled.
 */
export interface TxScore {
  FixtureId: number;
  /**
   * `string` here (e.g. `"scheduled"`) — unlike the numeric `GameState` on
   * `TxFixture`. Same field name, different type, different endpoint.
   */
  GameState: string;
  StartTime: number;
  IsTeam: boolean;
  FixtureGroupId: number;
  CompetitionId: number;
  CountryId: number;
  SportId: number;
  Participant1IsHome: boolean;
  Participant1Id: number;
  Participant2Id: number;
  /** e.g. "comment" | "goal" | "substitution" | "lineups" | "game_finalised" | ... — open-ended, not enumerated. */
  Action: string;
  Id: number;
  Ts: number;
  ConnectionId: number;
  Seq: number;
  /** Map of numeric stat-code strings to values, e.g. `{"1": 0, "1007": 5}` — codes undocumented. */
  Stats: Record<string, unknown>;
  CoverageSecondaryData?: boolean;
  CoverageType?: string;
  Confirmed?: boolean;
  /** Present once the match has a live/settled status (not on pre-kickoff comment/coverage events). */
  StatusId?: number;
  Type?: string;
  Clock?: { Running: boolean; Seconds: number };
  /** Per-participant, per-period stat breakdown (Corners, Goals, YellowCards, ...); shape varies by sport. */
  Score?: Record<string, unknown>;
  /** Per-`Action`-type event payload — e.g. `{GoalType, PlayerId}` for `"goal"`, `{StatusId}` for `"status"`. */
  Data?: Record<string, unknown>;
  Lineups?: unknown[];
  PlayerStats?: unknown;
  Possession?: number;
  PossessionType?: unknown;
  PossibleEvent?: unknown;
  Kickoff?: unknown;
  Participant?: number;
  Parti1State?: unknown;
  Parti2State?: unknown;
}

/**
 * GET /api/scores/stat-validation (legacy mode) response shapes — the
 * Merkle proof chain (stat -> fixture sub-tree -> daily batch root) needed
 * to CPI into TxLINE's `validate_stat` (see
 * `anchor/programs/verifibet/src/instructions/resolve_market.rs`). Not
 * documented in CLAUDE.md/NOTES.md at the time this was written — found by
 * fetching `https://txline-dev.txodds.com/docs/docs.yaml` directly, since
 * neither the fixtures/odds/scores endpoints already documented there cover
 * proof data. Field names are camelCase here (this is TxLINE's off-chain
 * REST wire format), unlike the snake_case Rust `ScoreStat`/`StatTerm`
 * types the on-chain CPI consumes — same underlying data, different layer.
 */
export interface TxProofNode {
  /** Base64-encoded 32-byte hash (OpenAPI `format: binary`). */
  hash: string;
  isRightSibling: boolean;
}

export interface TxScoreStat {
  key: number;
  value: number;
  period: number;
}

export interface TxScoresUpdateStats {
  updateCount: number;
  minTimestamp: number;
  maxTimestamp: number;
}

export interface TxScoresBatchSummary {
  fixtureId: number;
  updateStats: TxScoresUpdateStats;
  /** Base64-encoded 32-byte hash. */
  eventStatsSubTreeRoot: string;
}

/** GET /api/scores/stat-validation — legacy mode (`statKey`/`statKey2`). */
export interface TxScoresStatValidation {
  ts: number;
  statToProve: TxScoreStat;
  /** Base64-encoded 32-byte hash. */
  eventStatRoot: string;
  summary: TxScoresBatchSummary;
  statProof: TxProofNode[];
  subTreeProof: TxProofNode[];
  mainTreeProof: TxProofNode[];
  statToProve2?: TxScoreStat;
  statProof2?: TxProofNode[];
}

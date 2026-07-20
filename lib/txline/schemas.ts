/**
 * Zod schemas mirroring `lib/txline/types.ts` — used by `lib/txline/client.ts`
 * to validate every TxLINE response before it's trusted by the rest of the
 * app. Field names/optionality here must stay in lockstep with types.ts;
 * update both together.
 */
import { z } from "zod";

export const TxFixtureSchema = z.object({
  Ts: z.number(),
  StartTime: z.number(),
  Competition: z.string(),
  CompetitionId: z.number(),
  FixtureGroupId: z.number(),
  Participant1Id: z.number(),
  Participant1: z.string(),
  Participant2Id: z.number(),
  Participant2: z.string(),
  FixtureId: z.number(),
  Participant1IsHome: z.boolean(),
  GameState: z.number().optional(),
});
export const TxFixturesSchema = z.array(TxFixtureSchema);

export const TxOddsSchema = z.object({
  FixtureId: z.number(),
  MessageId: z.string(),
  Ts: z.number(),
  Bookmaker: z.string(),
  BookmakerId: z.number(),
  SuperOddsType: z.string(),
  GameState: z.string().nullable(),
  InRunning: z.boolean(),
  MarketParameters: z.string(),
  MarketPeriod: z.string(),
  PriceNames: z.array(z.string()),
  Prices: z.array(z.number()),
  Pct: z.array(z.string()),
});
export const TxOddsListSchema = z.array(TxOddsSchema);

/**
 * `TxScore`'s always-present envelope (17 fields, see types.ts) is
 * required; everything else is `Action`-dependent and typed loosely rather
 * than modeling all 40+ real `Action` shapes, matching types.ts's own
 * approach.
 */
export const TxScoreSchema = z.object({
  FixtureId: z.number(),
  GameState: z.string(),
  StartTime: z.number(),
  IsTeam: z.boolean(),
  FixtureGroupId: z.number(),
  CompetitionId: z.number(),
  CountryId: z.number(),
  SportId: z.number(),
  Participant1IsHome: z.boolean(),
  Participant1Id: z.number(),
  Participant2Id: z.number(),
  Action: z.string(),
  Id: z.number(),
  Ts: z.number(),
  ConnectionId: z.number(),
  Seq: z.number(),
  Stats: z.record(z.string(), z.unknown()),
  CoverageSecondaryData: z.boolean().optional(),
  CoverageType: z.string().optional(),
  Confirmed: z.boolean().optional(),
  StatusId: z.number().optional(),
  Type: z.string().optional(),
  Clock: z.object({ Running: z.boolean(), Seconds: z.number() }).optional(),
  Score: z.record(z.string(), z.unknown()).optional(),
  Data: z.record(z.string(), z.unknown()).optional(),
  Lineups: z.array(z.unknown()).optional(),
  PlayerStats: z.unknown().optional(),
  Possession: z.number().optional(),
  PossessionType: z.unknown().optional(),
  PossibleEvent: z.unknown().optional(),
  Kickoff: z.unknown().optional(),
  Participant: z.number().optional(),
  Parti1State: z.unknown().optional(),
  Parti2State: z.unknown().optional(),
});
export const TxScoresSchema = z.array(TxScoreSchema);

// Real 32-byte hash, as a plain array of 32 numbers — NOT the base64
// string the OpenAPI spec's `format: binary` implies. Confirmed against
// a real response (see lib/txline/types.ts's TxProofNode doc comment).
const TxHashBytesSchema = z.array(z.number()).length(32);

export const TxProofNodeSchema = z.object({
  hash: TxHashBytesSchema,
  isRightSibling: z.boolean(),
});

/**
 * OpenAPI types every `List_ProofNode` field as `oneOf [Nil, ProofNode[]]`
 * — `Nil` is an empty-object sentinel (Rust codegen artifact for "no
 * proof needed", e.g. a single-leaf sub-tree). Normalized to `[]` here so
 * callers only ever see an array.
 */
const TxListProofNodeSchema = z
  .union([z.array(TxProofNodeSchema), z.object({}).loose()])
  .transform((v) => (Array.isArray(v) ? v : []));

export const TxScoreStatSchema = z.object({
  key: z.number(),
  value: z.number(),
  period: z.number(),
});

export const TxScoresUpdateStatsSchema = z.object({
  updateCount: z.number(),
  minTimestamp: z.number(),
  maxTimestamp: z.number(),
});

export const TxScoresBatchSummarySchema = z.object({
  fixtureId: z.number(),
  updateStats: TxScoresUpdateStatsSchema,
  eventStatsSubTreeRoot: TxHashBytesSchema,
});

export const TxScoresStatValidationSchema = z.object({
  ts: z.number(),
  statToProve: TxScoreStatSchema,
  eventStatRoot: TxHashBytesSchema,
  summary: TxScoresBatchSummarySchema,
  statProof: TxListProofNodeSchema,
  subTreeProof: TxListProofNodeSchema,
  mainTreeProof: TxListProofNodeSchema,
  statToProve2: TxScoreStatSchema.optional(),
  statProof2: TxListProofNodeSchema.optional(),
});

/**
 * TxLINE wire types -> VERIFIBET domain types. The only place these
 * mappings are implemented — `lib/txline/stream.ts` imports `toOddsSnapshot`
 * and `toScoreEvent` from here rather than redefining them, and
 * `deriveOutcome` is the **only** place outcomes are computed anywhere in
 * the app (keeper and tests both import it — never re-derive an outcome
 * inline).
 *
 * ## Status mapping
 *
 * Two independent status signals exist, at different granularity, and this
 * module never mixes them up:
 *
 * - `TxFixture.GameState` (number; `toFixture`'s source) only distinguishes
 *   "not finished" (`1`) from "finished" (`3`) — confirmed against every
 *   fixture in a live full-tournament snapshot (see NOTES.md). There is no
 *   observed code that means specifically "live" as opposed to "scheduled
 *   but not started" — `1` covers both, so `toFixture` maps it to
 *   `SCHEDULED` rather than guessing `LIVE`. `undefined` (far-future
 *   fixtures with no state assigned yet) also maps to `SCHEDULED`.
 * - `TxScore.StatusId` (number; `toScoreEvent`'s source) is far more
 *   granular — 13 distinct values observed across 27 real fixtures'
 *   score-event histories (pre-match, 1st half, half-time, 2nd half,
 *   ET-prep, ET1, ET-half, ET2, post-ET, pens-prep, pens, post-pens,
 *   finished). `1` -> `SCHEDULED`, `100` -> `FINISHED`, everything else
 *   observed -> `LIVE`. Checked *after* `Action === "game_finalised"`,
 *   though, not on its own — see `fixtureStatusFromActionAndStatusId`'s
 *   doc comment for a real gap this closes (TxLINE sometimes omits
 *   `StatusId` entirely on the very event that means the match just
 *   ended).
 *
 * `TxScore.GameState` (the *string* field, confusingly shaped the same
 * as `TxFixture`'s but a different type) is **not** used for status at
 * all — every event in every real fixture captured for this module,
 * including each match's own `game_finalised` event, showed the literal
 * string `"scheduled"`. It never varies within a fixture in practice, so
 * there's nothing to map.
 *
 * Any status code (in either direction above) outside the ranges just
 * described — i.e. a real one this module hasn't seen yet — maps to
 * `SCHEDULED` with a `console.warn`, never a crash.
 *
 * ## Outcome mapping (`deriveOutcome`)
 *
 * Group stage is a plain FT 1X2 comparison. Knockout stages (everything
 * else — `R32`/`R16`/`QF`/`SF`/`THIRD`/`FINAL`) never resolve to a draw:
 * the match runs to extra time and then penalties until someone advances,
 * so `deriveOutcome` compares `ScoreEvent.home`/`away` (FT+ET goals) first
 * and only falls back to `homePens`/`awayPens` when those are tied.
 *
 * TxLINE's real penalty-shootout encoding was reverse-engineered from a
 * live fixture, not assumed: `18175983`, Germany v Paraguay, World Cup
 * Round of 32 (`documentation/scores/schedule.mdx` in
 * `github.com/txodds/tx-on-chain`; NOTES.md has the full derivation).
 * That match's final `game_finalised` `Score` shows:
 *
 * ```json
 * "Participant1": { "Total": { "Goals": 1 }, "PE": { "Goals": 3 }, ... }
 * "Participant2": { "Total": { "Goals": 1 }, "PE": { "Goals": 4 }, ... }
 * ```
 *
 * i.e. `Total.Goals` (1-1) is the FT+ET score — tied — with `PE.Goals`
 * (3-4) as the separate penalty-shootout tally deciding it: Paraguay
 * (`Participant2`, away) advances 4-3 on pens despite a 1-1 scoreline.
 * `scores-r32-paraguay-germany.sample.json` at the repo root is that
 * fixture's full real captured event history (this module's golden pens
 * vector); `scores-r32-argentina-capeverde.sample.json` is a second real
 * fixture (`18175918`) that also confirms `Total.Goals` = FT + ET (not
 * FT alone) via a match decided by *extra-time goals*, no shootout
 * needed: Argentina 3 (1 FT + 2 ET) - Cape Verde 2 (1 FT + 1 ET).
 */
import type {
  Fixture,
  FixtureStage,
  FixtureStatus,
  OddsSnapshot,
  Outcome,
  ScoreEvent,
} from "@/lib/types";
import type { TxFixture, TxOdds, TxScore } from "@/lib/txline/types";

/**
 * Every `FixtureGroupId` this curated demo dataset actually uses, mapped
 * to its real stage — confirmed by cross-referencing a live full-
 * tournament `/api/fixtures/snapshot` response against
 * `documentation/scores/schedule.mdx`'s named brackets (join key:
 * `FixtureId`, since neither source alone names *and* numbers the stage).
 * TxLINE's OpenAPI spec has no `round`/`stage` field on `Fixture` at
 * all — this table is the only way to derive one. See NOTES.md for the
 * full fixtureId-by-fixtureId join.
 */
const STAGE_BY_GROUP_ID: Record<number, FixtureStage> = {
  10115674: "GROUP",
  10115677: "R32",
  10115574: "R16",
  10115675: "QF",
  10115573: "SF",
  10115771: "THIRD",
  10115676: "FINAL",
};

function warnUnknown(context: string, value: unknown): void {
  console.warn(`[txline] normalize: unrecognized ${context} (${JSON.stringify(value)}), defaulting`);
}

function stageForGroupId(groupId: number): FixtureStage {
  const stage = STAGE_BY_GROUP_ID[groupId];
  if (stage !== undefined) return stage;
  warnUnknown("FixtureGroupId", groupId);
  return "GROUP";
}

function fixtureStatusFromGameState(gameState: number | undefined): FixtureStatus {
  if (gameState === undefined) return "SCHEDULED";
  if (gameState === 1) return "SCHEDULED";
  if (gameState === 3) return "FINISHED";
  warnUnknown("TxFixture.GameState", gameState);
  return "SCHEDULED";
}

const KNOWN_LIVE_STATUS_IDS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

/**
 * `action === "game_finalised"` is checked *before* `statusId` — TxLINE
 * inconsistently omits `StatusId` entirely on that action (real,
 * confirmed by comparing all three golden fixtures at the repo root:
 * Brazil v Norway's and Argentina v Cape Verde's `game_finalised` events
 * both carry `StatusId: 100`, but Paraguay v Germany's carries no
 * `StatusId` key at all). Without this override, that fixture's
 * genuinely-finished final event would fall through to the `undefined ->
 * SCHEDULED` default and misreport a decided match as not yet started.
 * `action` itself has no such gap — every real fixture's finalizing event
 * uses the literal string `"game_finalised"`, always.
 *
 * Exported (not just used internally by `toScoreEvent`) because
 * `lib/txline/statusTracker.ts` needs the exact same mapping applied to
 * the scores-stream envelope fields on *every* frame, including the many
 * `Action`s that carry no `Score` data at all and so never reach
 * `toScoreEvent` — status tracking can't miss those, only the score
 * value can be legitimately absent. Single source of truth either way.
 */
export function fixtureStatusFromActionAndStatusId(
  action: string,
  statusId: number | undefined,
): FixtureStatus {
  if (action === "game_finalised") return "FINISHED";

  if (statusId === undefined) return "SCHEDULED";
  if (statusId === 1) return "SCHEDULED";
  if (statusId === 100) return "FINISHED";
  if (KNOWN_LIVE_STATUS_IDS.has(statusId)) return "LIVE";
  warnUnknown("TxScore.StatusId", statusId);
  return "SCHEDULED";
}

/**
 * GET /api/fixtures/snapshot entry -> domain `Fixture`. Deliberately
 * doesn't set `Fixture.isDemo` here even though it could (a demo fixture
 * is identifiable purely from `FixtureId` — see
 * `lib/txline/demoScenarios.ts#isDemoFixtureId`): that check does real
 * `readFileSync` I/O, and this module is imported at runtime by at least
 * one client component (`MatchDetailBoard.tsx`, for
 * `fixtureStatusFromActionAndStatusId`) — pulling `node:fs` in here broke
 * the client bundle outright (confirmed the hard way: `UnhandledSchemeError:
 * Reading from "node:fs"` from webpack). `isDemo` is set one layer up
 * instead, in `lib/txline/statusTracker.ts#hydrate` — server-only by
 * actual enforced usage (only `app/api/fixtures/route.ts` and
 * `keeper/index.ts` ever call it at runtime), not just by convention.
 */
export function toFixture(raw: TxFixture): Fixture {
  const home = raw.Participant1IsHome ? raw.Participant1 : raw.Participant2;
  const away = raw.Participant1IsHome ? raw.Participant2 : raw.Participant1;

  return {
    fixtureId: raw.FixtureId,
    home,
    away,
    kickoffTs: Math.floor(raw.StartTime / 1000),
    stage: stageForGroupId(raw.FixtureGroupId),
    status: fixtureStatusFromGameState(raw.GameState),
  };
}

/**
 * Full-time 1X2 `OddsPayload` -> domain `OddsSnapshot`, restricted to
 * markets with exactly 3 outcomes and price labels matching a common 1X2
 * convention (`Home`/`Draw`/`Away`, `1`/`X`/`2`, ...) — returns `null`
 * (nothing to emit) for anything else, e.g. over/under or handicap lines,
 * rather than guessing which price is which.
 *
 * **Unverified against a real non-empty payload.** TxLINE's OpenAPI spec
 * types `PriceNames` as a bare `string[]` (no enum/examples); every real
 * probe of the odds snapshot/stream endpoints during this and the prior
 * session returned empty/heartbeats-only. Re-verify the label-matching
 * convention against a real captured `OddsPayload` before trusting it.
 */
const HOME_LABELS = new Set(["home", "1", "team1", "participant1"]);
const DRAW_LABELS = new Set(["draw", "x"]);
const AWAY_LABELS = new Set(["away", "2", "team2", "participant2"]);

export function toOddsSnapshot(raw: TxOdds): OddsSnapshot | null {
  if (raw.PriceNames.length !== 3 || raw.Prices.length !== 3) return null;

  const indexFor = (labels: Set<string>) =>
    raw.PriceNames.findIndex((name) => labels.has(name.trim().toLowerCase()));

  const homeIdx = indexFor(HOME_LABELS);
  const drawIdx = indexFor(DRAW_LABELS);
  const awayIdx = indexFor(AWAY_LABELS);
  if (homeIdx === -1 || drawIdx === -1 || awayIdx === -1) return null;

  // "1953" = 1.953 (see TxOdds.Prices in lib/txline/types.ts).
  const decimalOdds = (scaled: number) => scaled / 1000;
  const rawPct = (idx: number) => {
    const pct = raw.Pct[idx];
    return pct === "NA" ? 0 : Number(pct);
  };

  const rawPcts: [number, number, number] = [
    rawPct(homeIdx),
    rawPct(drawIdx),
    rawPct(awayIdx),
  ];
  const sum = rawPcts[0] + rawPcts[1] + rawPcts[2];
  // sum === 0 only when every price is "NA" (a market with no live
  // quotes) — nothing honest to normalize against, so 0/0 fair shares.
  const impliedPct: [number, number, number] =
    sum === 0
      ? [0, 0, 0]
      : [(rawPcts[0] / sum) * 100, (rawPcts[1] / sum) * 100, (rawPcts[2] / sum) * 100];

  return {
    fixtureId: raw.FixtureId,
    home: decimalOdds(raw.Prices[homeIdx]),
    draw: decimalOdds(raw.Prices[drawIdx]),
    away: decimalOdds(raw.Prices[awayIdx]),
    impliedPct,
    overroundPct: sum - 100,
    ts: raw.Ts,
  };
}

interface RawGoalTotals {
  goals: number | undefined;
  pens: number | undefined;
}

function goalTotals(participant: unknown): RawGoalTotals {
  const p = participant as
    | { Total?: { Goals?: number }; PE?: { Goals?: number } }
    | undefined;
  return { goals: p?.Total?.Goals, pens: p?.PE?.Goals };
}

/**
 * Scores-snapshot/-stream entry -> domain `ScoreEvent`. Only produces one
 * when `raw.Score` is present at all — most `Action`s (comment, lineups,
 * venue, ...) carry no score data whatsoever and are correctly dropped
 * (returns `null`). When `Score` *is* present but a side's `Total.Goals`
 * key is absent, that means 0 goals (not "unknown") — confirmed via a
 * real 0-0-after-ET fixture (Switzerland v Colombia, `18202783`, decided
 * 4-3 on penalties with `Total` present on both sides but no `Goals` key
 * at all; see NOTES.md) — so this does not drop the frame, it reports 0.
 */
export function toScoreEvent(raw: TxScore): ScoreEvent | null {
  if (raw.Score === undefined) return null;

  const home = goalTotals(raw.Score.Participant1);
  const away = goalTotals(raw.Score.Participant2);

  return {
    fixtureId: raw.FixtureId,
    home: home.goals ?? 0,
    away: away.goals ?? 0,
    homePens: home.pens,
    awayPens: away.pens,
    minute: raw.Clock ? Math.floor(raw.Clock.Seconds / 60) : undefined,
    status: fixtureStatusFromActionAndStatusId(raw.Action, raw.StatusId),
  };
}

/**
 * The single place any outcome is computed, anywhere in this app —
 * keeper (settlement) and tests both import this rather than re-deriving
 * it. See the module doc comment for the real golden-vector evidence
 * behind the knockout-tiebreak logic.
 */
export function deriveOutcome(score: ScoreEvent, stage: FixtureStage): Outcome {
  if (stage === "GROUP") {
    if (score.home > score.away) return 0;
    if (score.away > score.home) return 2;
    return 1;
  }

  // Knockout: FT+ET first (score.home/away already excludes PE — see
  // toScoreEvent). A draw here means it went to penalties.
  if (score.home > score.away) return 0;
  if (score.away > score.home) return 2;

  if (score.homePens === undefined || score.awayPens === undefined) {
    throw new Error(
      `deriveOutcome: fixture ${score.fixtureId} (${stage}) tied ${score.home}-${score.away} after extra time with no penalty data — cannot determine who advanced`,
    );
  }
  if (score.homePens === score.awayPens) {
    throw new Error(
      `deriveOutcome: fixture ${score.fixtureId} (${stage}) tied ${score.homePens}-${score.homePens} on penalties — a completed shootout can't end level`,
    );
  }
  return score.homePens > score.awayPens ? 0 : 2;
}

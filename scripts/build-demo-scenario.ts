/**
 * Data-prep tool that builds `demo-data/scenarios/<name>.{ndjson,rest.json}`
 * for the four scenarios (Session 7.4) built from real captured/fetched
 * TxLINE data: `qf-thriller`, `underdog`, `late-drama`, `final-preview`.
 * Not part of the app's runtime path — `lib/txline/replaySource.ts` only
 * ever reads the generated files, never this script — kept checked in
 * (rather than thrown away after one run) so each scenario is
 * reproducible/auditable rather than a black-box hand-edited JSON blob.
 * Re-run with `pnpm tsx scripts/build-demo-scenario.ts`.
 *
 * `pens` (`demo-data/scenarios/pens.*`, formerly `paraguay-germany-r32`,
 * Session 7.1) is deliberately **not** rebuilt here — it already has a
 * richer, hand-tuned odds trajectory keyed off the real penalty-shootout
 * action sequence (`penalty_shootout_team`/`penalty_outcome`) that this
 * script's simpler start/goal/final-anchor shape would flatten, not
 * improve. See git history for the script version that built it.
 *
 * ## What's real here, and what isn't — stated plainly, not buried
 *
 * Same disclosure as `pens`'s own history: **every `scores` line below is
 * real, unmodified TxLINE data** (only `FixtureId` is rewritten to the
 * demo offset), and **every `odds` line is synthetic-but-plausible**, not
 * real — confirmed again this session that no real non-empty TxLINE odds
 * payload has ever been captured anywhere in this project (devnet Service
 * Level 1 odds only exist "within the current 5-minute interval" of a
 * live match, and every real fixture used below finished weeks before
 * this session). All four scenarios below are therefore labeled
 * `source: "reconstructed"` or `"synthetic"` in their `.chapters.json` —
 * see that file's own `source` field for which.
 *
 * ## Why there's no genuinely `"recorded"` scenario yet
 *
 * `scripts/record-stream.ts` (Session 7.2) was built to capture a live
 * feed event-by-event, which is the only way to get a truly real,
 * granular, goal-by-goal timeline — but by the time it existed, both
 * semifinals had already passed (see NOTES.md), so it was never actually
 * run against a live match. Confirmed directly this session: even
 * `GET /api/scores/snapshot/{fixtureId}` (with or without `asOf=`)
 * against a real, already-finished fixture returns at most **one event
 * per distinct `Action` type** (the latest occurrence of each), not the
 * full historical log — e.g. a 3-goal match still shows exactly one
 * `"goal"` entry, with the *cumulative* score in its `Score` field, not
 * three separate goal events at three separate times. That's true of
 * every real captured sample in this repo, not just freshly-fetched
 * ones (`scores.sample.json`, `scores-r32-*.sample.json` all show the
 * same one-event-per-Action-type shape) — it's a real characteristic of
 * TxLINE's REST snapshot endpoint, not a data-staleness bug. So "trimmed
 * kickoff→goal→FT" below means real kickoff/goal/full-time *moments*,
 * each a real single timestamp, not a real minute-by-minute broadcast.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (existsSync(join(__dirname, "..", ".env.local"))) {
  process.loadEnvFile(join(__dirname, "..", ".env.local"));
}
import { getFixtures } from "@/lib/txline/client";
import { txlineFetch } from "@/lib/txline/http";
import { TxScoresSchema } from "@/lib/txline/schemas";
import type { TxFixture, TxOdds, TxScore } from "@/lib/txline/types";

/**
 * Fetches a real fixture's scores snapshot directly, bypassing
 * `lib/txline/client.ts#getScores` — that function checks
 * `isDemoFixtureId`, which loads *every* registered scenario's
 * `.rest.json` (including the ones this very script is about to write),
 * a circular dependency the first time a new scenario is built. This
 * script only ever fetches real (non-demo) fixture IDs, so the demo
 * check is never needed here anyway.
 */
async function fetchRealScores(fixtureId: number): Promise<TxScore[]> {
  const response = await txlineFetch(`/api/scores/snapshot/${fixtureId}`);
  return TxScoresSchema.parse(await response.json());
}

const DEMO_FIXTURE_OFFSET = 9_000_000;
const TOURNAMENT_START_EPOCH_DAY = 20_632; // see lib/txline/statusTracker.ts

const repoRoot = join(__dirname, "..");
const scenariosDir = join(repoRoot, "demo-data", "scenarios");

interface NdjsonLine {
  t: number; // ms since scenario start
  event: "scores" | "odds";
  data: TxScore | TxOdds;
}

function odds(
  demoFixtureId: number,
  t: number,
  ts: number,
  messageId: string,
  home: number,
  draw: number,
  away: number,
): NdjsonLine {
  const homePct = 1 / home;
  const drawPct = 1 / draw;
  const awayPct = 1 / away;
  const overround = homePct + drawPct + awayPct;
  const pct = (p: number) => ((p / overround) * 100).toFixed(3);

  const data: TxOdds = {
    FixtureId: demoFixtureId,
    MessageId: messageId,
    Ts: ts,
    Bookmaker: "TxODDS Demo Book",
    BookmakerId: 1,
    SuperOddsType: "1X2",
    GameState: null,
    InRunning: true,
    MarketParameters: "",
    MarketPeriod: "FT",
    PriceNames: ["Home", "Draw", "Away"],
    Prices: [Math.round(home * 1000), Math.round(draw * 1000), Math.round(away * 1000)],
    Pct: [pct(homePct), pct(drawPct), pct(awayPct)],
  };
  return { t, event: "odds", data };
}

function dateLabel(startTimeMs: number): string {
  return new Date(startTimeMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function findFixture(all: TxFixture[], fixtureId: number): TxFixture {
  const match = all.find((f) => f.FixtureId === fixtureId);
  if (!match) throw new Error(`fixture ${fixtureId} not found in TxLINE's fixtures snapshot`);
  return match;
}

/** Real captured events for a real match, filtered/rewritten/sorted the
 * same way every scenario in this project has been built since `pens`:
 * drop the pre-match `coverage_update` admin ping (its real `Ts` sits
 * hours-to-days before match action, which would open the replay with
 * dead air — see `pens`'s original build-script history), rewrite
 * `FixtureId` to the demo offset, sort by real `Ts`. */
function prepareRealScores(raw: TxScore[], demoFixtureId: number): TxScore[] {
  return raw
    .filter((e) => e.Action !== "coverage_update")
    .map((e) => ({ ...e, FixtureId: demoFixtureId }))
    .sort((a, b) => a.Ts - b.Ts);
}

interface RealAnchors {
  /** Real `Ts` of the first (non-coverage_update) event — this scenario's
   * own t=0. */
  startTs: number;
  /** Real `Ts` of the `"goal"` action — see this module's doc comment on
   * why there's only ever one, holding the cumulative score. */
  goalTs: number;
  /** Real `Ts` of `"game_finalised"`. */
  finalTs: number;
}

function findAnchors(scores: TxScore[]): RealAnchors {
  const startTs = scores[0].Ts;
  const goal = scores.find((e) => e.Action === "goal");
  const final = scores.find((e) => e.Action === "game_finalised");
  if (!goal) throw new Error("no real \"goal\" event found to pin synthetic odds against");
  if (!final) throw new Error("no real \"game_finalised\" event found to pin synthetic odds against");
  return { startTs, goalTs: goal.Ts, finalTs: final.Ts };
}

/**
 * Every call site below passes `GameState: 1` on the embedded `fixture`,
 * overriding whatever the real fetched fixture's own `GameState` was
 * (`3` — already decided — for `underdog`/`late-drama`/`final-preview`,
 * confirmed against the live snapshot). `toFixture`'s
 * `fixtureStatusFromGameState` (`lib/txline/normalize.ts`) reads that
 * field to seed a fixture's *initial* tracked status before any replay
 * event has played — leaving the real `3` in would make those three
 * scenarios render as "Resolved" from the moment a viewer lands on the
 * page, before a single chapter has played, defeating the entire point
 * of a kickoff→goal→full-time replay. Forcing `1` (`SCHEDULED`) makes
 * every demo scenario start its life the same honest way: nothing has
 * happened yet in *this replay*, however the real match actually ended.
 */
function writeScenario(
  scenarioName: string,
  scoreLines: NdjsonLine[],
  oddsLines: NdjsonLine[],
  meta: {
    matchup: string;
    label: string;
    realFixtureId: number;
    demoFixtureId: number;
  },
  fixture: TxFixture,
  scores: TxScore[],
): void {
  const allLines = [...scoreLines, ...oddsLines].sort((a, b) => a.t - b.t);
  mkdirSync(scenariosDir, { recursive: true });

  const ndjsonPath = join(scenariosDir, `${scenarioName}.ndjson`);
  writeFileSync(ndjsonPath, allLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  console.log(`wrote ${ndjsonPath} (${allLines.length} lines, ${scoreLines.length} scores + ${oddsLines.length} odds)`);

  const durationMs = allLines.length > 0 ? allLines[allLines.length - 1].t : 0;
  const finalOdds = oddsLines.length > 0 ? (oddsLines[oddsLines.length - 1].data as TxOdds) : undefined;

  const restBundle = {
    meta: { scenario: scenarioName, ...meta, durationMs },
    fixture,
    scores,
    odds: finalOdds ? [finalOdds] : [],
  };

  const restPath = join(scenariosDir, `${scenarioName}.rest.json`);
  writeFileSync(restPath, JSON.stringify(restBundle, null, 2) + "\n");
  console.log(`wrote ${restPath}`);
}

/**
 * `qf-thriller` — Argentina v Switzerland, real World Cup quarterfinal
 * (`FixtureGroupId` 10115675), fetched live (no local sample existed for
 * this fixture). Real result: Argentina 3–1 after extra time, with a
 * Switzerland red card in the second half — genuine knockout drama, not
 * a fabricated scoreline.
 */
async function buildQfThriller(allFixtures: TxFixture[]): Promise<void> {
  const REAL_FIXTURE_ID = 18222446;
  const DEMO_FIXTURE_ID = REAL_FIXTURE_ID + DEMO_FIXTURE_OFFSET;
  const fixture = findFixture(allFixtures, REAL_FIXTURE_ID);
  const scores = prepareRealScores(await fetchRealScores(REAL_FIXTURE_ID), DEMO_FIXTURE_ID);
  const { startTs, goalTs, finalTs } = findAnchors(scores);

  const scoreLines: NdjsonLine[] = scores.map((e) => ({ t: e.Ts - startTs, event: "scores", data: e }));

  const oddsLines: NdjsonLine[] = [
    // Pre-match: Argentina (home) favored, as the eventual finalists.
    odds(DEMO_FIXTURE_ID, 0, startTs, "qf-odds-1", 1.75, 3.6, 4.8),
    odds(DEMO_FIXTURE_ID, 900_000, startTs + 900_000, "qf-odds-2", 1.8, 3.55, 4.6),
    // Switzerland hang on, market tightens toward the underdog through
    // regulation — real knockout tension, not a one-sided procession.
    odds(DEMO_FIXTURE_ID, 2_700_000, startTs + 2_700_000, "qf-odds-3", 2.0, 3.4, 3.9),
    odds(DEMO_FIXTURE_ID, 4_500_000, startTs + 4_500_000, "qf-odds-4", 2.15, 3.35, 3.6),
    // Extra time — level, market prices a coin-flip finish.
    odds(DEMO_FIXTURE_ID, goalTs - startTs - 300_000, goalTs - 300_000, "qf-odds-5", 2.3, 3.5, 3.2),
    // Real captured decisive goal (Argentina's, sealing the 3-1 win).
    odds(DEMO_FIXTURE_ID, goalTs - startTs + 10_000, goalTs + 10_000, "qf-odds-6", 1.35, 5.2, 8.5),
    odds(DEMO_FIXTURE_ID, goalTs - startTs + 300_000, goalTs + 300_000, "qf-odds-7", 1.25, 6.0, 11.0),
    // Real captured full-time — nothing left to quote after this.
    odds(DEMO_FIXTURE_ID, finalTs - startTs - 5_000, finalTs - 5_000, "qf-odds-8", 1.2, 7.0, 13.0),
  ];

  writeScenario(
    "qf-thriller",
    scoreLines,
    oddsLines,
    {
      matchup: "Argentina v Switzerland — Quarterfinal, extra time",
      label: `${dateLabel(fixture.StartTime)} QF`,
      realFixtureId: REAL_FIXTURE_ID,
      demoFixtureId: DEMO_FIXTURE_ID,
    },
    { ...fixture, FixtureId: DEMO_FIXTURE_ID, GameState: 1 },
    scores,
  );
}

/**
 * `underdog` — Brazil v Norway, real World Cup Round of 16 fixture
 * (local sample `scores.sample.json`, already this codebase's own golden
 * Merkle-proof/`deriveOutcome` vector — see `lib/txline/normalize.test.ts`
 * / `proof.sample.json`). Real result: Norway win 2–1 — a clean, decisive
 * upset, not a near-miss.
 */
async function buildUnderdog(allFixtures: TxFixture[]): Promise<void> {
  const REAL_FIXTURE_ID = 18187298;
  const DEMO_FIXTURE_ID = REAL_FIXTURE_ID + DEMO_FIXTURE_OFFSET;
  const fixture = findFixture(allFixtures, REAL_FIXTURE_ID);
  const raw = JSON.parse(readFileSync(join(repoRoot, "scores.sample.json"), "utf-8")) as TxScore[];
  const scores = prepareRealScores(raw, DEMO_FIXTURE_ID);
  const { startTs, goalTs, finalTs } = findAnchors(scores);

  const scoreLines: NdjsonLine[] = scores.map((e) => ({ t: e.Ts - startTs, event: "scores", data: e }));

  const oddsLines: NdjsonLine[] = [
    // Pre-match: Brazil (home) heavily favored — the real quality gap
    // this upset actually overturned.
    odds(DEMO_FIXTURE_ID, 0, startTs, "underdog-odds-1", 1.55, 4.2, 6.5),
    odds(DEMO_FIXTURE_ID, 1_500_000, startTs + 1_500_000, "underdog-odds-2", 1.6, 4.1, 6.0),
    odds(DEMO_FIXTURE_ID, 3_500_000, startTs + 3_500_000, "underdog-odds-3", 1.7, 3.9, 5.2),
    // Norway hold firm into the second half — the market starts to take
    // the shock seriously before it's confirmed.
    odds(DEMO_FIXTURE_ID, 5_500_000, startTs + 5_500_000, "underdog-odds-4", 1.95, 3.6, 4.1),
    // Real captured decisive goal — Norway's second, completing the 2-1
    // upset.
    odds(DEMO_FIXTURE_ID, goalTs - startTs + 10_000, goalTs + 10_000, "underdog-odds-5", 5.5, 5.8, 1.45),
    odds(DEMO_FIXTURE_ID, goalTs - startTs + 300_000, goalTs + 300_000, "underdog-odds-6", 8.0, 6.5, 1.25),
    // Real captured full-time.
    odds(DEMO_FIXTURE_ID, finalTs - startTs - 5_000, finalTs - 5_000, "underdog-odds-7", 11.0, 8.0, 1.12),
  ];

  writeScenario(
    "underdog",
    scoreLines,
    oddsLines,
    {
      matchup: "Brazil v Norway — Round of 16 upset",
      label: `${dateLabel(fixture.StartTime)} R16`,
      realFixtureId: REAL_FIXTURE_ID,
      demoFixtureId: DEMO_FIXTURE_ID,
    },
    { ...fixture, FixtureId: DEMO_FIXTURE_ID, GameState: 1 },
    scores,
  );
}

/**
 * `late-drama` — Argentina v Cape Verde, real World Cup Round of 32
 * fixture (local sample `scores-r32-argentina-capeverde.sample.json`).
 * Real result: Argentina 3–2 after extra time — Cape Verde matched
 * Argentina goal-for-goal through regulation and into extra time before
 * finally losing it late. "Last stretch" here means the real captured
 * decisive goal (deep in extra time, ~92% of the way through the real
 * captured timeline — see this session's own timing analysis), not
 * literally the 75th-90th minute of regulation; TxLINE's REST snapshot
 * has no finer-grained real timing to pin a literal in-regulation minute
 * against (see this module's doc comment).
 */
async function buildLateDrama(allFixtures: TxFixture[]): Promise<void> {
  const REAL_FIXTURE_ID = 18175918;
  const DEMO_FIXTURE_ID = REAL_FIXTURE_ID + DEMO_FIXTURE_OFFSET;
  const fixture = findFixture(allFixtures, REAL_FIXTURE_ID);
  const raw = JSON.parse(
    readFileSync(join(repoRoot, "scores-r32-argentina-capeverde.sample.json"), "utf-8"),
  ) as TxScore[];
  const scores = prepareRealScores(raw, DEMO_FIXTURE_ID);
  const { startTs, goalTs, finalTs } = findAnchors(scores);

  const scoreLines: NdjsonLine[] = scores.map((e) => ({ t: e.Ts - startTs, event: "scores", data: e }));

  const oddsLines: NdjsonLine[] = [
    // Pre-match: Argentina heavily favored — Cape Verde are the
    // tournament's real Cinderella entrant.
    odds(DEMO_FIXTURE_ID, 0, startTs, "late-odds-1", 1.3, 5.5, 9.0),
    odds(DEMO_FIXTURE_ID, 2_000_000, startTs + 2_000_000, "late-odds-2", 1.35, 5.3, 8.2),
    // Cape Verde hang on level into the second half and extra time — the
    // odds compress hard as the shock draws closer to becoming real.
    odds(DEMO_FIXTURE_ID, 5_000_000, startTs + 5_000_000, "late-odds-3", 1.6, 4.6, 5.8),
    odds(DEMO_FIXTURE_ID, 8_500_000, startTs + 8_500_000, "late-odds-4", 1.85, 4.0, 4.3),
    // Extra time, still level — as close as this market gets to pricing
    // a genuine minnow upset.
    odds(DEMO_FIXTURE_ID, goalTs - startTs - 600_000, goalTs - 600_000, "late-odds-5", 2.1, 3.7, 3.5),
    odds(DEMO_FIXTURE_ID, goalTs - startTs - 120_000, goalTs - 120_000, "late-odds-6", 2.0, 3.8, 3.6),
    // Real captured decisive goal — Argentina's extra-time winner, the
    // late swing that ends the upset bid.
    odds(DEMO_FIXTURE_ID, goalTs - startTs + 10_000, goalTs + 10_000, "late-odds-7", 1.2, 6.5, 12.0),
    // Real captured full-time.
    odds(DEMO_FIXTURE_ID, finalTs - startTs - 5_000, finalTs - 5_000, "late-odds-8", 1.15, 7.5, 15.0),
  ];

  writeScenario(
    "late-drama",
    scoreLines,
    oddsLines,
    {
      matchup: "Argentina v Cape Verde — Round of 32, extra time",
      label: `${dateLabel(fixture.StartTime)} R32`,
      realFixtureId: REAL_FIXTURE_ID,
      demoFixtureId: DEMO_FIXTURE_ID,
    },
    { ...fixture, FixtureId: DEMO_FIXTURE_ID, GameState: 1 },
    scores,
  );
}

/**
 * `final-preview` — Spain v Argentina, the real World Cup Final
 * (`FixtureId` 18257739, real kickoff 2026-07-19). Unlike the other three
 * scenarios, this one is **entirely synthetic beyond the fixture
 * identity itself**: no real score events at all, deliberately, so the
 * replay never transitions the fixture past `SCHEDULED` — a genuine
 * pre-match "preview" rather than a compressed full match. Every odds
 * tick is a fabricated, plausible pre-match drift, not pinned against any
 * real captured event (there is nothing real to pin against pre-kickoff).
 * Labeled `source: "synthetic"` in `final-preview.chapters.json`,
 * honestly distinct from the other three's `"reconstructed"`.
 */
async function buildFinalPreview(allFixtures: TxFixture[]): Promise<void> {
  const REAL_FIXTURE_ID = 18257739;
  const DEMO_FIXTURE_ID = REAL_FIXTURE_ID + DEMO_FIXTURE_OFFSET;
  const fixture = findFixture(allFixtures, REAL_FIXTURE_ID);

  // Compressed pre-match window — no real timestamps to pin against, so
  // this is just a plausible several-hour drift ending well before an
  // (unreached) kickoff.
  const startTs = fixture.StartTime - 6 * 60 * 60 * 1000; // 6h before real kickoff
  const oddsLines: NdjsonLine[] = [
    odds(DEMO_FIXTURE_ID, 0, startTs, "preview-odds-1", 2.1, 3.5, 3.3),
    odds(DEMO_FIXTURE_ID, 1_800_000, startTs + 1_800_000, "preview-odds-2", 2.05, 3.5, 3.35),
    odds(DEMO_FIXTURE_ID, 3_600_000, startTs + 3_600_000, "preview-odds-3", 2.0, 3.5, 3.4),
    // A lineup-news-shaped tightening toward Spain a couple hours out.
    odds(DEMO_FIXTURE_ID, 7_200_000, startTs + 7_200_000, "preview-odds-4", 1.92, 3.55, 3.5),
    odds(DEMO_FIXTURE_ID, 12_600_000, startTs + 12_600_000, "preview-odds-5", 1.88, 3.6, 3.55),
    odds(DEMO_FIXTURE_ID, 18_000_000, startTs + 18_000_000, "preview-odds-6", 1.85, 3.62, 3.6),
    odds(DEMO_FIXTURE_ID, 21_000_000, startTs + 21_000_000, "preview-odds-7", 1.83, 3.65, 3.62),
  ];

  writeScenario(
    "final-preview",
    [],
    oddsLines,
    {
      matchup: "Spain v Argentina — World Cup Final preview",
      label: `${dateLabel(fixture.StartTime)} Final preview`,
      realFixtureId: REAL_FIXTURE_ID,
      demoFixtureId: DEMO_FIXTURE_ID,
    },
    { ...fixture, FixtureId: DEMO_FIXTURE_ID, GameState: 1 },
    [],
  );
}

async function main(): Promise<void> {
  const allFixtures = await getFixtures({ competition: 72, from: TOURNAMENT_START_EPOCH_DAY * 86_400 });
  await buildQfThriller(allFixtures);
  await buildUnderdog(allFixtures);
  await buildLateDrama(allFixtures);
  await buildFinalPreview(allFixtures);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

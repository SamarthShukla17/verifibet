/**
 * One-off data-prep tool that built `demo-data/scenarios/paraguay-germany-r32.ndjson`
 * + `.rest.json` from this repo's own real captured TxLINE data
 * (`scores-r32-paraguay-germany.sample.json`, `fixtures.sample.json` — the
 * same golden vector `lib/txline/normalize.test.ts` already uses for
 * `deriveOutcome`'s penalty-shootout case). Not part of the app's runtime
 * path — `lib/txline/replaySource.ts` only ever reads the two generated
 * files, never this script — kept checked in (rather than thrown away
 * after one run) so the scenario is reproducible/auditable rather than a
 * black-box hand-edited JSON blob. Re-run with `pnpm tsx
 * scripts/build-demo-scenario.ts` if the source sample data ever changes.
 *
 * ## What's real here, and what isn't — stated plainly, not buried
 *
 * - **Every `scores` line is real, unmodified TxLINE data**, chronologically
 *   ordered by its own real `Ts`, with only two changes: `FixtureId` is
 *   rewritten to the demo offset (see `lib/txline/demoScenarios.ts`), and
 *   the very first captured event (`coverage_update`, `Seq: 0`) is dropped
 *   — its real `Ts` sits a genuine ~64.5 hours before everything else (an
 *   unrelated system health-check ping, not match action), which would
 *   otherwise open the replay with 64 real hours of dead air before
 *   anything visible happens.
 * - **Every `odds` line is synthetic-but-plausible, not real.** Confirmed
 *   directly this session (and matching `lib/txline/normalize.test.ts`'s
 *   own `toOddsSnapshot` test doc comment, which flags the same gap): no
 *   real non-empty TxLINE odds payload has ever been captured anywhere in
 *   this project — devnet Service Level 1 odds only exist "within the
 *   current 5-minute interval" of a live match, and every fixture in this
 *   dataset finished weeks before this session. There is nothing real to
 *   replay for odds, so this script constructs a plausible trajectory
 *   (pre-match Germany-favored, tightening after the real captured `goal`
 *   event since the match finishes level, wide swings through the real
 *   penalty-shootout sequence, holding at the last tick once
 *   `game_finalised` fires — a real market has nothing left to quote
 *   after that) timed against the *real* event timestamps around it. This
 *   is the one part of the scenario that is not a recording.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (existsSync(join(__dirname, "..", ".env.local"))) {
  process.loadEnvFile(join(__dirname, "..", ".env.local"));
}
import { getFixtures } from "@/lib/txline/client";
import type { TxFixture, TxOdds, TxScore } from "@/lib/txline/types";

const DEMO_FIXTURE_OFFSET = 9_000_000;
const REAL_FIXTURE_ID = 18175983; // Germany v Paraguay, R32 — see NOTES.md
const DEMO_FIXTURE_ID = REAL_FIXTURE_ID + DEMO_FIXTURE_OFFSET;
const SCENARIO_NAME = "paraguay-germany-r32";

const repoRoot = join(__dirname, "..");
const scenariosDir = join(repoRoot, "demo-data", "scenarios");

interface NdjsonLine {
  t: number; // ms since scenario start
  event: "scores" | "odds";
  data: TxScore | TxOdds;
}

function loadRealScores(): TxScore[] {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, "scores-r32-paraguay-germany.sample.json"), "utf-8"),
  ) as TxScore[];
  // Drop the one pre-match admin ping (~64.5h before everything else —
  // see module doc comment) and rewrite FixtureId to the demo offset.
  return raw
    .filter((e) => e.Action !== "coverage_update")
    .map((e) => ({ ...e, FixtureId: DEMO_FIXTURE_ID }))
    .sort((a, b) => a.Ts - b.Ts);
}

/** `fixtures.sample.json` at the repo root only has 14 R16 fixtures — it
 * doesn't cover R32, so this fetches the real fixture record live from
 * TxLINE instead (same `competition`/`from` window `scripts/sync-markets.ts`
 * uses). Real, current TxLINE data either way — this fetch just isn't
 * from a pre-captured sample file. */
async function findRealFixture(): Promise<TxFixture> {
  const TOURNAMENT_START_EPOCH_DAY = 20_632; // see scripts/sync-markets.ts
  const fixtures = await getFixtures({ competition: 72, from: TOURNAMENT_START_EPOCH_DAY * 86_400 });
  const match = fixtures.find((f) => f.FixtureId === REAL_FIXTURE_ID);
  if (!match) {
    throw new Error(`fixture ${REAL_FIXTURE_ID} not found in TxLINE's fixtures snapshot`);
  }
  return match;
}

function odds(
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
    FixtureId: DEMO_FIXTURE_ID,
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

async function main() {
  const realScores = loadRealScores();
  const realFixture = await findRealFixture();
  const startTs = realScores[0].Ts;

  const scoreLines: NdjsonLine[] = realScores.map((e) => ({
    t: e.Ts - startTs,
    event: "scores",
    data: e,
  }));

  // Real timestamps this synthetic odds trajectory is pinned against —
  // see module doc comment for why the *values* below aren't real.
  const tsAt = (action: string) => {
    const e = realScores.find((s) => s.Action === action);
    if (!e) throw new Error(`no real "${action}" event found to pin synthetic odds against`);
    return e.Ts;
  };
  const tsConnected = tsAt("connected");
  const tsGoal = tsAt("goal");
  const tsPenaltyShootoutTeam = tsAt("penalty_shootout_team");
  const tsPenaltyOutcome = tsAt("penalty_outcome");
  const tsGameFinalised = tsAt("game_finalised");

  const oddsLines: NdjsonLine[] = [
    // Pre-match: Germany (home) favored.
    odds(tsConnected - startTs, tsConnected, "demo-odds-1", 1.95, 3.4, 4.2),
    odds(tsConnected - startTs + 60_000, tsConnected + 60_000, "demo-odds-2", 1.92, 3.45, 4.3),
    // First half through kickoff of the second — the real captured
    // events here (venue/lineups/players_on_the_pitch/halftime_finalised)
    // are all pre-goal admin/status events with nothing decisive to
    // reprice against, so this fills what would otherwise be a ~3-minute
    // real-time gap (at the default 60x) with plausible minor drift
    // rather than one long dead stretch — a viewer landing on the page
    // at any point should see the market move at a steady cadence, not
    // just at the two or three moments something dramatic happens.
    odds(1_600_000, tsConnected + 1_600_000, "demo-odds-3", 1.93, 3.42, 4.25),
    odds(3_200_000, tsConnected + 3_200_000, "demo-odds-4", 1.9, 3.48, 4.35),
    odds(4_800_000, tsConnected + 4_800_000, "demo-odds-5", 1.88, 3.5, 4.4),
    // ~halftime_finalised (real captured, content offset ~6,003,400ms) —
    // still scoreless, odds essentially unchanged from pre-match.
    odds(6_400_000, tsConnected + 6_400_000, "demo-odds-6", 1.9, 3.4, 4.3),
    odds(8_000_000, tsConnected + 8_000_000, "demo-odds-7", 1.87, 3.45, 4.4),
    odds(9_600_000, tsConnected + 9_600_000, "demo-odds-8", 1.8, 3.5, 4.5),
    // Real captured goal — the match finishes level, so both directions
    // tighten toward each other rather than either side running away.
    odds(tsGoal - startTs + 5_000, tsGoal + 5_000, "demo-odds-9", 1.7, 3.6, 5.1),
    odds(tsGoal - startTs + 400_000, tsGoal + 400_000, "demo-odds-10", 1.85, 3.5, 4.6),
    // Extra time — level scoreline, market prices a near-even shootout risk.
    odds(tsGoal - startTs + 900_000, tsGoal + 900_000, "demo-odds-11", 2.1, 3.9, 3.4),
    // Real captured penalty-shootout sequence — genuinely volatile, no
    // stable "true price" exists shot-to-shot.
    odds(tsPenaltyShootoutTeam - startTs, tsPenaltyShootoutTeam, "demo-odds-12", 1.6, 8.0, 2.3),
    odds(tsPenaltyShootoutTeam - startTs + 15_000, tsPenaltyShootoutTeam + 15_000, "demo-odds-13", 3.1, 12.0, 1.42),
    // Real captured shootout result — Paraguay (away) wins 4-3. Last tick:
    // a real market has nothing left to quote once game_finalised fires,
    // so this is deliberately the final odds line in the file.
    odds(tsPenaltyOutcome - startTs + 5_000, tsPenaltyOutcome + 5_000, "demo-odds-14", 45.0, 60.0, 1.02),
  ];

  if (tsGameFinalised < tsPenaltyOutcome) {
    throw new Error("game_finalised must come after penalty_outcome — sample data assumption broke");
  }

  const allLines = [...scoreLines, ...oddsLines].sort((a, b) => a.t - b.t);

  mkdirSync(scenariosDir, { recursive: true });
  const ndjsonPath = join(scenariosDir, `${SCENARIO_NAME}.ndjson`);
  writeFileSync(ndjsonPath, allLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  console.log(`wrote ${ndjsonPath} (${allLines.length} lines, ${scoreLines.length} scores + ${oddsLines.length} odds)`);

  const durationMs = allLines[allLines.length - 1].t;
  console.log(`real captured duration: ${(durationMs / 1000 / 60).toFixed(1)} minutes`);

  const demoFixture: TxFixture = {
    ...realFixture,
    FixtureId: DEMO_FIXTURE_ID,
  };

  const finalOdds = oddsLines[oddsLines.length - 1].data as TxOdds;

  const dateLabel = new Date(demoFixture.StartTime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const restBundle = {
    meta: {
      scenario: SCENARIO_NAME,
      /** The full matchup — not currently shown anywhere, kept for the
       * scenario picker/controls session 7.3 builds. */
      matchup: "Germany v Paraguay — extra time & penalties",
      /** The exact parenthetical `components/DemoReplayBanner.tsx`'s pill
       * shows: "▶ DEMO REPLAY — recorded TxLINE data (Jun 29 R32) · 60×".
       * Real kickoff date + real stage, not fabricated to match any
       * particular example wording. */
      label: `${dateLabel} R32`,
      realFixtureId: REAL_FIXTURE_ID,
      demoFixtureId: DEMO_FIXTURE_ID,
      durationMs,
    },
    fixture: demoFixture,
    scores: realScores,
    odds: [finalOdds],
  };

  const restPath = join(scenariosDir, `${SCENARIO_NAME}.rest.json`);
  writeFileSync(restPath, JSON.stringify(restBundle, null, 2) + "\n");
  console.log(`wrote ${restPath}`);
}

if (!existsSync(join(repoRoot, "scores-r32-paraguay-germany.sample.json"))) {
  throw new Error("run this from the repo root — scores-r32-paraguay-germany.sample.json not found");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

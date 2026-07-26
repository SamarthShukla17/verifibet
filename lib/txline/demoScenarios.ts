/**
 * The registry `lib/txline/client.ts`, `lib/txline/stream.ts`, and
 * `lib/txline/normalize.ts` all read to know whether `DEMO_MODE` is on,
 * which scenarios exist, and which fixture IDs are demo ones — one place,
 * not three copies of "is this a demo fixture" logic that could drift.
 * Server-only by the same convention as the rest of `lib/txline/*` (no
 * `server-only` package, so `scripts/build-demo-scenario.ts` can still
 * import types from here via `tsx`).
 *
 * Each scenario is a `demo-data/scenarios/<name>.rest.json` bundle (built
 * by `scripts/build-demo-scenario.ts` — see that file's own doc comment
 * for what's real vs. synthetic in it) plus a sibling `<name>.ndjson`
 * `lib/txline/replaySource.ts` reads directly. This module only ever
 * reads the `.rest.json` half — the REST snapshot data
 * `lib/txline/client.ts` serves for a demo fixture.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { TxFixture, TxOdds, TxScore } from "@/lib/txline/types";

/**
 * Added to a scenario's real captured `FixtureId` to get its demo
 * fixture ID — e.g. Germany v Paraguay's real `18175983` becomes
 * `27175983`. Chosen specifically so a demo fixture's on-chain `Market`
 * PDA (`lib/solana/pda.ts#deriveMarket`, seeded on `fixture_id`) can never
 * collide with any real market's PDA: every real World Cup `FixtureId`
 * observed in this project is in the ~17-18 million range, comfortably
 * below this offset, and a demo ID (real + this) lands in the ~26-27
 * million range, comfortably above every real one.
 */
export const DEMO_FIXTURE_OFFSET = 9_000_000;

/** `demo-data/scenarios/<name>.{ndjson,rest.json}` basenames — add here
 * when `scripts/build-demo-scenario.ts` produces a new scenario. Order
 * here is just registration order — `sourcePriority`/`listDemoScenarios`
 * below is what actually ranks them for display/default-pick purposes. */
const SCENARIO_NAMES = ["pens", "qf-thriller", "underdog", "late-drama", "final-preview"] as const;

/**
 * How honestly-real a scenario's underlying data is — surfaced in the
 * demo pill (Session 7.4) so a viewer never mistakes a fabricated replay
 * for a real one. `"recorded"` (captured live, event-by-event, via
 * `scripts/record-stream.ts`) ranks above `"reconstructed"` (real match
 * identity + real captured kickoff/goal/full-time moments, synthetic
 * odds — see `scripts/build-demo-scenario.ts`'s own doc comment for why
 * every scenario in this project is at best this tier right now, never
 * `"recorded"`), which ranks above `"synthetic"` (no real underlying
 * match events at all, e.g. `final-preview`).
 */
export type DemoSource = "recorded" | "reconstructed" | "synthetic";

const SOURCE_RANK: Record<DemoSource, number> = { recorded: 0, reconstructed: 1, synthetic: 2 };

/** Lower is "more real" — sort scenarios with this to put recorded
 * before reconstructed before synthetic. */
export function sourcePriority(source: DemoSource): number {
  return SOURCE_RANK[source];
}

export interface DemoScenarioMeta {
  scenario: string;
  /** The full matchup description — not shown by the pill itself, kept
   * for the scenario picker/controls Session 7.3 builds. */
  matchup: string;
  /** The exact "(...)" content `components/DemoReplayBanner.tsx`'s pill
   * shows — e.g. "Jun 29 R32". Real kickoff date + real stage. */
  label: string;
  realFixtureId: number;
  demoFixtureId: number;
  /** ms — the real captured span this scenario's `.ndjson` replays. */
  durationMs: number;
}

export interface DemoScenario {
  meta: DemoScenarioMeta;
  fixture: TxFixture;
  /** Full real score-event history (all real, see `scripts/build-demo-scenario.ts`) —
   * what `lib/txline/client.ts#getScores` serves for this demo fixture,
   * matching `GET /api/scores/snapshot/{fixtureId}`'s real semantics
   * (every logged event, not just the latest). */
  scores: TxScore[];
  /** What `lib/txline/client.ts#getOdds` serves for this demo fixture —
   * the scenario's final odds tick only, matching a real settled
   * fixture's "nothing left to quote" REST snapshot. Live odds *movement*
   * comes from `lib/txline/replaySource.ts` over the SSE pipeline, not
   * from this REST snapshot. */
  odds: TxOdds[];
}

export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "1";
}

export function getDemoSpeed(): number {
  const parsed = Number(process.env.DEMO_SPEED);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

function scenarioPath(name: string, ext: "rest.json" | "ndjson" | "chapters.json"): string {
  return join(process.cwd(), "demo-data", "scenarios", `${name}.${ext}`);
}

/** Absolute path to a scenario's `.ndjson` — the one thing
 * `lib/txline/replaySource.ts` needs from this module besides the
 * scenario name itself. */
export function scenarioNdjsonPath(name: string): string {
  return scenarioPath(name, "ndjson");
}

export interface DemoChapter {
  label: string;
  /** ms since the scenario's own t=0 — the same unit `ReplaySource`'s
   * `jumpTo` and the `.ndjson`'s own `t` field use, so a chapter button's
   * value can be POSTed to `/api/demo/control` unchanged. */
  t: number;
}

/**
 * `demo-data/scenarios/<name>.chapters.json`'s full shape (Session 7.4) —
 * `title`/`source`/`capturedAt` alongside the chapter markers themselves,
 * since this hand-written file is the one place a scenario's honesty
 * label naturally lives (the `.ndjson`/`.rest.json` are both
 * machine-generated by `scripts/build-demo-scenario.ts`, which has no
 * business making a judgment call about how "real" its own output is).
 */
export interface DemoChapterFile {
  title: string;
  source: DemoSource;
  /** ISO 8601 — the real-world date/time this scenario's underlying data
   * reflects (a real match's real kickoff, or, for a `"synthetic"`
   * scenario, the fabricated preview's nominal as-of date). */
  capturedAt: string;
  chapters: DemoChapter[];
}

/** Used only when a scenario's `.chapters.json` is missing or malformed
 * — still fully replayable (chapters are optional quick-jump markers,
 * see below), but with nothing to safely claim about its source, so this
 * defaults to the most conservative label rather than guessing
 * `"recorded"`. */
function fallbackChapterFile(scenario: string): DemoChapterFile {
  return { title: scenario, source: "synthetic", capturedAt: "", chapters: [] };
}

let chaptersCache: Map<string, DemoChapterFile> | undefined;

/** Hand-written `demo-data/scenarios/<name>.chapters.json` — unlike the
 * `.ndjson`/`.rest.json` (both machine-generated by
 * `scripts/build-demo-scenario.ts`), chapter markers (and the
 * title/source/capturedAt alongside them) are a judgment call, so
 * there's no generator for this file. Falls back to
 * `fallbackChapterFile` (not a throw) when a scenario has none — a
 * scenario is still fully replayable without chapter markers, just
 * without quick-jump buttons or an honest source label for it. */
export function loadDemoChapterFile(scenario: string): DemoChapterFile {
  if (!chaptersCache) chaptersCache = new Map();
  const existing = chaptersCache.get(scenario);
  if (existing) return existing;

  let file: DemoChapterFile;
  try {
    file = JSON.parse(readFileSync(scenarioPath(scenario, "chapters.json"), "utf-8"));
  } catch {
    file = fallbackChapterFile(scenario);
  }
  chaptersCache.set(scenario, file);
  return file;
}

let cached: DemoScenario[] | undefined;

/** Reads + parses every registered scenario's `.rest.json` once, cached
 * for the life of the process (same `globalThis`-free module-level
 * memoization as `lib/config.ts`-style constants — these files never
 * change at runtime, no hot-reload invalidation concern like the
 * stateful singletons in `lib/txline/statusTracker.ts`/`stream.ts`). */
export function loadDemoScenarios(): DemoScenario[] {
  if (cached) return cached;
  cached = SCENARIO_NAMES.map((name) => {
    const raw = readFileSync(scenarioPath(name, "rest.json"), "utf-8");
    return JSON.parse(raw) as DemoScenario;
  });
  return cached;
}

export function isDemoFixtureId(fixtureId: number): boolean {
  return loadDemoScenarios().some((s) => s.meta.demoFixtureId === fixtureId);
}

export function findScenarioByDemoFixtureId(fixtureId: number): DemoScenario | undefined {
  return loadDemoScenarios().find((s) => s.meta.demoFixtureId === fixtureId);
}

export function findScenarioByRealFixtureId(fixtureId: number): DemoScenario | undefined {
  return loadDemoScenarios().find((s) => s.meta.realFixtureId === fixtureId);
}

export function findScenarioByName(scenario: string): DemoScenario | undefined {
  return loadDemoScenarios().find((s) => s.meta.scenario === scenario);
}

export interface DemoScenarioSummary {
  scenario: string;
  title: string;
  source: DemoSource;
  demoFixtureId: number;
}

/** Every registered scenario's picker-facing summary (Session 7.4's
 * `DemoControlPopover` scenario picker), ranked most-real first
 * (`sourcePriority`) — "recorded beats reconstructed beats synthetic" as
 * a genuine ordering, not just a description. Stable within a rank
 * (`Array.prototype.sort` is stable), so ties keep `SCENARIO_NAMES`'s
 * registration order. */
export function listDemoScenarios(): DemoScenarioSummary[] {
  return loadDemoScenarios()
    .map((s) => {
      const chapterFile = loadDemoChapterFile(s.meta.scenario);
      return {
        scenario: s.meta.scenario,
        title: chapterFile.title,
        source: chapterFile.source,
        demoFixtureId: s.meta.demoFixtureId,
      };
    })
    .sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source));
}

/** The scenario `/api/demo` shows by default when no `?scenario=` is
 * given — the most-real one currently registered ("the video should show
 * recorded wherever possible," and failing that, reconstructed over
 * synthetic). */
export function pickDefaultScenario(): DemoScenario | undefined {
  const best = listDemoScenarios()[0];
  return best ? findScenarioByName(best.scenario) : undefined;
}

/**
 * Honest local commitment for a demo-range market's `resolve_market_attested`
 * resolution (Session 7 exit) — a plain sha256 over the scenario identity
 * + derived outcome + final score, never a stand-in for a real TxLINE
 * Merkle proof. The one place this preimage is defined; both
 * `keeper/demoResolver.ts` (computing it to submit on-chain) and
 * `lib/receipts.ts` (recomputing it to render an honest demo receipt)
 * import it from here rather than keeping their own copies that could
 * drift out of sync with each other.
 */
export function demoProofHash(scenario: string, fixtureId: number, outcome: number, home: number, away: number): Buffer {
  const preimage = `demo-scenario:${scenario}:${fixtureId}:${outcome}:${home}-${away}`;
  return createHash("sha256").update(preimage).digest();
}

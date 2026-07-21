import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  isKnockoutStage,
  marketFiltersToSearchParams,
  matchesFilters,
  organizeMatches,
  parseMarketFilters,
  type MarketFilters,
} from "@/lib/market";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

describe("isKnockoutStage", () => {
  it("is false only for GROUP", () => {
    expect(isKnockoutStage("GROUP")).toBe(false);
  });

  it("is true for every knockout stage, including THIRD (no dedicated filter tab, but still no possible draw)", () => {
    for (const stage of ["R32", "R16", "QF", "SF", "THIRD", "FINAL"] as const) {
      expect(isKnockoutStage(stage)).toBe(true);
    }
  });
});

function fixture(overrides: Partial<TrackedFixture>): TrackedFixture {
  return {
    fixtureId: 1,
    home: "France",
    away: "England",
    kickoffTs: 1_800_000_000,
    stage: "GROUP",
    status: "SCHEDULED",
    score: null,
    lastEventTs: 0,
    ...overrides,
  };
}

describe("matchesFilters", () => {
  it("passes everything under DEFAULT_FILTERS", () => {
    expect(matchesFilters(fixture({}), "OPEN", DEFAULT_FILTERS)).toBe(true);
  });

  it("filters by exact knockout stage", () => {
    const filters: MarketFilters = { ...DEFAULT_FILTERS, stage: "QF" };
    expect(matchesFilters(fixture({ stage: "QF" }), "OPEN", filters)).toBe(true);
    expect(matchesFilters(fixture({ stage: "SF" }), "OPEN", filters)).toBe(false);
  });

  it("filters group stage by letter, not just GROUP", () => {
    const filters: MarketFilters = { ...DEFAULT_FILTERS, stage: "GROUP_B" };
    expect(matchesFilters(fixture({ stage: "GROUP", group: "B" }), "OPEN", filters)).toBe(true);
    expect(matchesFilters(fixture({ stage: "GROUP", group: "A" }), "OPEN", filters)).toBe(false);
    expect(matchesFilters(fixture({ stage: "R16" }), "OPEN", filters)).toBe(false);
  });

  it("filters by market status", () => {
    const filters: MarketFilters = { ...DEFAULT_FILTERS, status: "RESOLVED" };
    expect(matchesFilters(fixture({}), "RESOLVED", filters)).toBe(true);
    expect(matchesFilters(fixture({}), "OPEN", filters)).toBe(false);
  });

  it("searches both team names, case-insensitively", () => {
    const filters: MarketFilters = { ...DEFAULT_FILTERS, search: "fra" };
    expect(matchesFilters(fixture({ home: "France", away: "England" }), "OPEN", filters)).toBe(true);
    expect(matchesFilters(fixture({ home: "Spain", away: "France" }), "OPEN", filters)).toBe(true);
    expect(matchesFilters(fixture({ home: "Spain", away: "England" }), "OPEN", filters)).toBe(false);
  });
});

describe("parseMarketFilters / marketFiltersToSearchParams", () => {
  it("round-trips a full filter set through the URL", () => {
    const filters: MarketFilters = { stage: "QF", status: "OPEN", search: "france" };
    const params = marketFiltersToSearchParams(filters);
    expect(params.toString()).toBe("stage=QF&status=open&q=france");
    expect(parseMarketFilters(params)).toEqual(filters);
  });

  it("parses status case-insensitively, matching the task's own ?status=open example", () => {
    const params = new URLSearchParams("stage=QF&status=open");
    expect(parseMarketFilters(params)).toEqual({ stage: "QF", status: "OPEN", search: "" });
  });

  it("falls back to ALL for garbage/unrecognized values instead of throwing", () => {
    const params = new URLSearchParams("stage=nonsense&status=whatever");
    expect(parseMarketFilters(params)).toEqual({ stage: "ALL", status: "ALL", search: "" });
  });

  it("an empty filter set produces an empty query string", () => {
    expect(marketFiltersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
  });
});

describe("organizeMatches", () => {
  const fixtures: TrackedFixture[] = [
    fixture({ fixtureId: 1, stage: "R16", status: "LIVE", kickoffTs: 2_000_000_000 }),
    fixture({ fixtureId: 2, stage: "R16", status: "LIVE", kickoffTs: 1_999_999_000 }),
    fixture({ fixtureId: 3, stage: "QF", status: "SCHEDULED", kickoffTs: 1_800_086_400 }), // day 2
    fixture({ fixtureId: 4, stage: "QF", status: "SCHEDULED", kickoffTs: 1_800_000_000 }), // day 1, earlier
    fixture({ fixtureId: 5, stage: "QF", status: "SCHEDULED", kickoffTs: 1_800_003_600 }), // day 1, later
    fixture({ fixtureId: 6, stage: "SF", status: "FINISHED", kickoffTs: 1_700_000_000 }),
    fixture({ fixtureId: 7, stage: "SF", status: "FINISHED", kickoffTs: 1_750_000_000 }),
  ];

  it("puts LIVE fixtures first, sorted by soonest kickoff, regardless of day", () => {
    const { live } = organizeMatches(fixtures, DEFAULT_FILTERS);
    expect(live.map((e) => e.fixture.fixtureId)).toEqual([2, 1]);
  });

  it("groups non-live/non-finished fixtures by UTC day, days ascending, soonest kickoff first within a day", () => {
    const { upcomingByDay } = organizeMatches(fixtures, DEFAULT_FILTERS);
    expect(upcomingByDay).toHaveLength(2);
    expect(upcomingByDay[0].entries.map((e) => e.fixture.fixtureId)).toEqual([4, 5]);
    expect(upcomingByDay[1].entries.map((e) => e.fixture.fixtureId)).toEqual([3]);
    expect(upcomingByDay[0].dateKey < upcomingByDay[1].dateKey).toBe(true);
  });

  it("collects FINISHED fixtures into `earlier`, most recently finished first", () => {
    const { earlier } = organizeMatches(fixtures, DEFAULT_FILTERS);
    expect(earlier.map((e) => e.fixture.fixtureId)).toEqual([7, 6]);
  });

  it("applies filters before grouping — totalCount reflects only what survives", () => {
    const { totalCount, live, upcomingByDay, earlier } = organizeMatches(fixtures, {
      ...DEFAULT_FILTERS,
      stage: "QF",
    });
    expect(totalCount).toBe(3);
    expect(live).toHaveLength(0);
    expect(earlier).toHaveLength(0);
    expect(upcomingByDay.flatMap((g) => g.entries)).toHaveLength(3);
  });
});

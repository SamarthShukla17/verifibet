import { describe, expect, it, vi } from "vitest";
import fixturesSample from "@/fixtures.sample.json";
import brazilNorwayScores from "@/scores.sample.json";
import paraguayGermanyScores from "@/scores-r32-paraguay-germany.sample.json";
import argentinaCapeVerdeScores from "@/scores-r32-argentina-capeverde.sample.json";
import { toFixture, toOddsSnapshot, toScoreEvent, deriveOutcome } from "@/lib/txline/normalize";
import type { TxFixture, TxOdds, TxScore } from "@/lib/txline/types";
import type { ScoreEvent } from "@/lib/types";

function gameFinalised(events: TxScore[]): TxScore {
  const finalised = events.filter((e) => e.Action === "game_finalised");
  if (finalised.length === 0) throw new Error("no game_finalised event in fixture");
  return finalised.reduce((latest, e) => (e.Seq > latest.Seq ? e : latest));
}

describe("toScoreEvent + deriveOutcome — real golden vectors", () => {
  // Brazil (home) 1 - 2 Norway (away), R16, decided in regulation — no
  // ET, no pens. The plain case every other vector below is contrasted
  // against.
  it("normal-time result: Brazil 1-2 Norway (R16)", () => {
    const raw = gameFinalised(brazilNorwayScores as TxScore[]);
    const score = toScoreEvent(raw);

    expect(score).not.toBeNull();
    expect(score).toMatchObject({
      fixtureId: 18187298,
      home: 1,
      away: 2,
      status: "FINISHED",
    });
    expect(score!.homePens).toBeUndefined();
    expect(score!.awayPens).toBeUndefined();

    expect(deriveOutcome(score!, "R16")).toBe(2); // away (Norway) wins
  });

  // The real golden vector this task exists to pin down: Germany (home)
  // 1-1 Paraguay (away) after full time + extra time, Paraguay advances
  // 4-3 on penalties. Fixture 18175983, World Cup Round of 32 (see
  // NOTES.md for the full derivation from a live TxLINE query).
  it("penalty-shootout result: Germany 1-1 Paraguay (FT+ET), Paraguay 3-4 on pens (R32)", () => {
    const raw = gameFinalised(paraguayGermanyScores as TxScore[]);
    const score = toScoreEvent(raw);

    expect(score).not.toBeNull();
    expect(score).toMatchObject({
      fixtureId: 18175983,
      home: 1,
      away: 1,
      homePens: 3,
      awayPens: 4,
      status: "FINISHED",
    });

    // A draw on the scoreline, but Paraguay (away) is the team that
    // actually advances — a knockout outcome must never be 1 (draw).
    expect(deriveOutcome(score!, "R32")).toBe(2);
  });

  // Second real golden vector: proves `Total.Goals` aggregates FT + ET
  // (not FT alone) via a match decided by extra-time goals with no
  // shootout at all. Argentina (home) scored in both ET periods.
  it("extra-time result (no shootout): Argentina 3-2 Cape Verde (R32)", () => {
    const raw = gameFinalised(argentinaCapeVerdeScores as TxScore[]);
    const score = toScoreEvent(raw);

    expect(score).not.toBeNull();
    expect(score).toMatchObject({
      fixtureId: 18175918,
      home: 3, // 1 FT + 2 ET
      away: 2, // 1 FT + 1 ET
      status: "FINISHED",
    });
    expect(score!.homePens).toBeUndefined();
    expect(score!.awayPens).toBeUndefined();

    expect(deriveOutcome(score!, "R32")).toBe(0); // home (Argentina) wins
  });
});

describe("toScoreEvent — edge cases", () => {
  it("treats an absent Total.Goals key as 0, not as missing data (real 0-0-after-ET golden case)", () => {
    // Switzerland 0-0 Colombia after FT+ET (neither `Total` object has a
    // `Goals` key at all — see NOTES.md / lib/txline/normalize.ts's doc
    // comment), decided 4-3 on penalties. Reconstructed from the real
    // captured event (fixture 18202783) rather than committing a 4th full
    // sample file, since only this one event matters for the assertion.
    const raw: TxScore = {
      FixtureId: 18202783,
      GameState: "scheduled",
      StartTime: 1783454400000,
      IsTeam: true,
      FixtureGroupId: 10115574,
      CompetitionId: 72,
      CountryId: 466,
      SportId: 1,
      Participant1IsHome: true,
      Participant1Id: 3099,
      Participant2Id: 1748,
      Action: "game_finalised",
      Id: 1186,
      Ts: 1783464750688,
      ConnectionId: 988,
      Seq: 1352,
      StatusId: 100,
      Stats: {},
      Score: {
        Participant1: { Total: { YellowCards: 3, Corners: 3 }, PE: { Goals: 4 } },
        Participant2: { Total: { YellowCards: 2, Corners: 7 }, PE: { Goals: 3 } },
      },
    };

    const score = toScoreEvent(raw);
    expect(score).toMatchObject({ home: 0, away: 0, homePens: 4, awayPens: 3 });
    expect(deriveOutcome(score!, "R16")).toBe(0); // Switzerland (home) wins on pens
  });

  it("drops events with no Score data at all", () => {
    const raw = (brazilNorwayScores as TxScore[]).find((e) => e.Action === "lineups")!;
    expect(raw.Score).toBeUndefined();
    expect(toScoreEvent(raw)).toBeNull();
  });

  it("maps an unrecognized StatusId to SCHEDULED with a warning, never crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = gameFinalised(brazilNorwayScores as TxScore[]);
    const mutated: TxScore = { ...raw, Action: "corner", StatusId: 999 };

    const score = toScoreEvent(mutated);
    expect(score?.status).toBe("SCHEDULED");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("deriveOutcome — group stage and error paths", () => {
  const base: ScoreEvent = { fixtureId: 1, home: 1, away: 1, status: "FINISHED" };

  it("group stage: a real draw is outcome 1", () => {
    expect(deriveOutcome(base, "GROUP")).toBe(1);
  });

  it("group stage: home/away wins are 0/2", () => {
    expect(deriveOutcome({ ...base, home: 2, away: 1 }, "GROUP")).toBe(0);
    expect(deriveOutcome({ ...base, home: 1, away: 2 }, "GROUP")).toBe(2);
  });

  it("knockout: throws rather than guessing when tied with no pens data", () => {
    expect(() => deriveOutcome(base, "R16")).toThrow(/no penalty data/);
  });

  it("knockout: throws on an impossible tied-penalties result", () => {
    const tied: ScoreEvent = { ...base, homePens: 5, awayPens: 5 };
    expect(() => deriveOutcome(tied, "QF")).toThrow(/tied.*on penalties/);
  });
});

describe("toFixture", () => {
  it("maps every real FixtureGroupId in fixtures.sample.json to its confirmed real stage", () => {
    const byGroup: Record<number, string> = {
      10115574: "R16",
      10115675: "QF",
      10115573: "SF",
      10115676: "FINAL",
      10115771: "THIRD",
    };

    for (const raw of fixturesSample as TxFixture[]) {
      const fixture = toFixture(raw);
      expect(fixture.stage).toBe(byGroup[raw.FixtureGroupId]);
      expect(fixture.fixtureId).toBe(raw.FixtureId);
      expect(fixture.kickoffTs).toBe(Math.floor(raw.StartTime / 1000));
    }
  });

  it("maps GameState 1/3/undefined to SCHEDULED/FINISHED/SCHEDULED", () => {
    const base: TxFixture = {
      Ts: 0,
      StartTime: 0,
      Competition: "World Cup",
      CompetitionId: 72,
      FixtureGroupId: 10115574,
      Participant1Id: 1,
      Participant1: "A",
      Participant2Id: 2,
      Participant2: "B",
      FixtureId: 1,
      Participant1IsHome: true,
    };

    expect(toFixture({ ...base, GameState: 1 }).status).toBe("SCHEDULED");
    expect(toFixture({ ...base, GameState: 3 }).status).toBe("FINISHED");
    expect(toFixture({ ...base, GameState: undefined }).status).toBe("SCHEDULED");
  });

  it("swaps home/away when Participant1IsHome is false", () => {
    const raw: TxFixture = {
      Ts: 0,
      StartTime: 0,
      Competition: "World Cup",
      CompetitionId: 72,
      FixtureGroupId: 10115574,
      Participant1Id: 1,
      Participant1: "A",
      Participant2Id: 2,
      Participant2: "B",
      FixtureId: 1,
      Participant1IsHome: false,
    };
    const fixture = toFixture(raw);
    expect(fixture.home).toBe("B");
    expect(fixture.away).toBe("A");
  });

  it("maps an unrecognized FixtureGroupId to GROUP with a warning, never crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw: TxFixture = {
      Ts: 0,
      StartTime: 0,
      Competition: "World Cup",
      CompetitionId: 72,
      FixtureGroupId: 999999,
      Participant1Id: 1,
      Participant1: "A",
      Participant2Id: 2,
      Participant2: "B",
      FixtureId: 1,
      Participant1IsHome: true,
    };
    expect(toFixture(raw).stage).toBe("GROUP");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("toOddsSnapshot", () => {
  // No real non-empty odds payload was ever captured across two sessions
  // of probing (see NOTES.md) — this is a synthetic-but-realistic
  // OddsPayload, not a golden vector. It exercises the math
  // (decimal-odds scaling, impliedPct normalization, overround) against
  // known inputs; it cannot confirm TxLINE's real `PriceNames` labels.
  const synthetic: TxOdds = {
    FixtureId: 1,
    MessageId: "m1",
    Ts: 1000,
    Bookmaker: "TestBook",
    BookmakerId: 1,
    SuperOddsType: "1X2",
    GameState: null,
    InRunning: false,
    MarketParameters: "",
    MarketPeriod: "FT",
    PriceNames: ["Home", "Draw", "Away"],
    Prices: [2000, 3500, 4000], // 2.000 / 3.500 / 4.000
    Pct: ["50.000", "28.571", "25.000"], // sums to 103.571 — 3.571 overround
  };

  it("converts scaled prices to decimal odds", () => {
    const snapshot = toOddsSnapshot(synthetic);
    expect(snapshot).toMatchObject({ fixtureId: 1, home: 2, draw: 3.5, away: 4, ts: 1000 });
  });

  it("normalizes impliedPct to sum to exactly 100 and reports the overround honestly", () => {
    const snapshot = toOddsSnapshot(synthetic)!;
    const [home, draw, away] = snapshot.impliedPct;
    expect(home + draw + away).toBeCloseTo(100, 9);
    expect(snapshot.overroundPct).toBeCloseTo(3.571, 3);
    // Still proportional to the raw quoted probabilities.
    expect(home).toBeGreaterThan(draw);
    expect(draw).toBeGreaterThan(away);
  });

  it("returns null for a non-3-outcome market rather than guessing", () => {
    expect(toOddsSnapshot({ ...synthetic, PriceNames: ["Over", "Under"], Prices: [1900, 1900], Pct: ["50.000", "50.000"] })).toBeNull();
  });

  it("returns null when price labels don't match any known 1X2 convention", () => {
    expect(toOddsSnapshot({ ...synthetic, PriceNames: ["Alpha", "Beta", "Gamma"] })).toBeNull();
  });
});

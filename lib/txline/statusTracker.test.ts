import { describe, expect, it, vi } from "vitest";
import paraguayGermanyScores from "@/scores-r32-paraguay-germany.sample.json";
import { StatusTracker } from "@/lib/txline/statusTracker";
import type { TxScore } from "@/lib/txline/types";
import type { Fixture } from "@/lib/types";

vi.mock("@/lib/txline/client", () => ({
  getFixturesResilient: vi.fn(),
  getScores: vi.fn(),
}));
import { getScores } from "@/lib/txline/client";

const PARAGUAY_GERMANY_FIXTURE: Fixture = {
  fixtureId: 18175983,
  home: "Germany",
  away: "Paraguay",
  kickoffTs: 1782765000,
  stage: "R32",
  status: "SCHEDULED",
};

describe("StatusTracker — replaying a real fixture's full event history", () => {
  it("transitions SCHEDULED -> LIVE -> FINISHED, firing onKickoff/onFinished exactly once each, matching the real deriveOutcome golden vector", async () => {
    const tracker = new StatusTracker();
    await tracker.hydrate([PARAGUAY_GERMANY_FIXTURE]);

    const kickoffs: number[] = [];
    const finishes: number[] = [];
    tracker.on("kickoff", (id) => kickoffs.push(id));
    tracker.on("finished", (id) => finishes.push(id));

    const events = (paraguayGermanyScores as TxScore[])
      .slice()
      .sort((a, b) => a.Seq - b.Seq);

    const transitions: string[] = [];
    let lastStatus = tracker.get(18175983)!.status;
    for (const raw of events) {
      tracker.ingest(raw);
      const current = tracker.get(18175983)!.status;
      if (current !== lastStatus) {
        transitions.push(`${lastStatus} -> ${current} (Seq ${raw.Seq}, Action "${raw.Action}")`);
        lastStatus = current;
      }
    }

    console.log(
      `[status-tracker test] fixture 18175983 real transitions:\n${transitions.join("\n")}`,
    );

    // Real event history: SCHEDULED (pre-match) -> LIVE (kickoff) ->
    // FINISHED (game_finalised) — never re-enters LIVE after finishing,
    // never skips straight to FINISHED without going LIVE first.
    expect(transitions[0]).toMatch(/^SCHEDULED -> LIVE/);
    expect(transitions[transitions.length - 1]).toMatch(/-> FINISHED/);
    expect(kickoffs).toEqual([18175983]);
    expect(finishes).toEqual([18175983]);

    const finalState = tracker.get(18175983)!;
    expect(finalState.status).toBe("FINISHED");
    // Matches lib/txline/normalize.test.ts's golden vector for this same
    // fixture: 1-1 after FT+ET, Paraguay advance 3-4 on penalties.
    expect(finalState.score).toMatchObject({ home: 1, away: 1, homePens: 3, awayPens: 4 });
  });

  it("ignores events for fixtures outside the hydrated set", async () => {
    const tracker = new StatusTracker();
    await tracker.hydrate([]);

    const raw = (paraguayGermanyScores as TxScore[]).find((e) => e.Action === "game_finalised")!;
    expect(() => tracker.ingest(raw)).not.toThrow();
    expect(tracker.get(18175983)).toBeUndefined();
  });
});

function makeTxScore(overrides: Partial<TxScore>): TxScore {
  return {
    FixtureId: 1,
    GameState: "scheduled",
    StartTime: 0,
    IsTeam: true,
    FixtureGroupId: 10115574,
    CompetitionId: 72,
    CountryId: 466,
    SportId: 1,
    Participant1IsHome: true,
    Participant1Id: 1,
    Participant2Id: 2,
    Action: "comment",
    Id: 1,
    Ts: 0,
    ConnectionId: 1,
    Seq: 1,
    Stats: {},
    ...overrides,
  };
}

describe("StatusTracker — self-healing silent-LIVE-fixture fallback", () => {
  it("polls getScores for a LIVE fixture that has gone silent, and applies the latest state", async () => {
    const tracker = new StatusTracker();
    await tracker.hydrate([{ ...PARAGUAY_GERMANY_FIXTURE, status: "LIVE" }]);

    // Force it stale — well past the 120s silent-LIVE threshold.
    tracker.get(18175983)!.lastEventTs = Date.now() - 200_000;

    vi.mocked(getScores).mockResolvedValue([
      makeTxScore({ FixtureId: 18175983, Action: "goal", StatusId: 4, Seq: 10, Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } },
      } }),
      makeTxScore({ FixtureId: 18175983, Action: "corner", StatusId: 4, Seq: 12 }), // no Score data — most recent by Seq
    ]);

    await tracker.checkForSilentLiveFixtures();

    expect(getScores).toHaveBeenCalledWith(18175983);
    const tracked = tracker.get(18175983)!;
    // Status comes from the truly-latest event (Seq 12, no Score) —
    // still LIVE (StatusId 4), so no transition/kickoff/finished fires.
    expect(tracked.status).toBe("LIVE");
    // Score falls back to the latest event that actually carries one
    // (Seq 10), not silently dropped just because Seq 12 has none.
    expect(tracked.score).toMatchObject({ home: 1, away: 0 });
    expect(Date.now() - tracked.lastEventTs).toBeLessThan(1000);
  });

  it("does not poll a fixture that isn't LIVE, or one that's LIVE but not silent", async () => {
    const tracker = new StatusTracker();
    await tracker.hydrate([
      { fixtureId: 1, home: "A", away: "B", kickoffTs: 0, stage: "R16", status: "SCHEDULED" },
      { fixtureId: 2, home: "C", away: "D", kickoffTs: 0, stage: "R16", status: "LIVE" },
    ]);
    // Fixture 2 is LIVE but freshly seeded (lastEventTs ~= now) — not silent.

    vi.mocked(getScores).mockClear();
    await tracker.checkForSilentLiveFixtures();

    expect(getScores).not.toHaveBeenCalled();
  });
});

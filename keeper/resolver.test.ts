import { describe, expect, it } from "vitest";
import { deriveStableStatus } from "@/keeper/resolver";
import type { TxScore } from "@/lib/txline/types";

/** Minimal-but-valid `TxScore` — only `Seq`/`Action`/`StatusId` matter to
 * `deriveStableStatus`, everything else is filler to satisfy the type. */
function event(seq: number, action: string, statusId?: number): TxScore {
  return {
    FixtureId: 1,
    GameState: "scheduled",
    StartTime: 0,
    IsTeam: false,
    FixtureGroupId: 1,
    CompetitionId: 72,
    CountryId: 0,
    SportId: 1,
    Participant1IsHome: true,
    Participant1Id: 1,
    Participant2Id: 2,
    Action: action,
    Id: seq,
    Ts: seq,
    ConnectionId: 1,
    Seq: seq,
    Stats: {},
    StatusId: statusId,
  };
}

describe("deriveStableStatus", () => {
  it("recognizes FINISHED even when a later, status-less event trails game_finalised", () => {
    // Regression test: fixture 18175983's real feed emits `disconnected`
    // (no StatusId) right after `game_finalised` — a naive "read only the
    // highest-Seq event" check reads that trailing event as SCHEDULED and
    // never recognizes the fixture as finished at all.
    const events = [
      event(1, "kickoff", 1),
      event(2, "status", 4),
      event(3, "game_finalised"),
      event(4, "disconnected"),
    ];
    expect(deriveStableStatus(events)).toBe("FINISHED");
  });

  it("is order-independent — Seq order, not array order, decides", () => {
    const events = [event(4, "disconnected"), event(3, "game_finalised"), event(1, "kickoff", 1)];
    expect(deriveStableStatus(events)).toBe("FINISHED");
  });

  it("stays SCHEDULED with no events, and LIVE mid-match", () => {
    expect(deriveStableStatus([])).toBe("SCHEDULED");
    expect(deriveStableStatus([event(1, "kickoff", 1), event(2, "status", 4)])).toBe("LIVE");
  });

  it("a mid-match status-less event never bounces LIVE back to SCHEDULED", () => {
    const events = [event(1, "kickoff", 1), event(2, "status", 4), event(3, "suspend")];
    expect(deriveStableStatus(events)).toBe("LIVE");
  });
});

import { describe, expect, it } from "vitest";
import { isVoidCandidate } from "@/keeper/void";

const DAY = 86_400;
const NOW = 1_800_000_000; // arbitrary fixed "now", in unix seconds

describe("isVoidCandidate", () => {
  it("is never a candidate once FINISHED, regardless of kickoff age", () => {
    expect(isVoidCandidate({ status: "FINISHED", kickoffTs: NOW - 10 * DAY }, NOW)).toBe(false);
  });

  it("POSTPONED/CANCELLED are always candidates, even right at kickoff", () => {
    expect(isVoidCandidate({ status: "POSTPONED", kickoffTs: NOW }, NOW)).toBe(true);
    expect(isVoidCandidate({ status: "CANCELLED", kickoffTs: NOW }, NOW)).toBe(true);
  });

  it("SCHEDULED/LIVE are candidates only once a full day past kickoff", () => {
    expect(isVoidCandidate({ status: "LIVE", kickoffTs: NOW - DAY - 1 }, NOW)).toBe(true);
    expect(isVoidCandidate({ status: "SCHEDULED", kickoffTs: NOW - DAY - 1 }, NOW)).toBe(true);
    expect(isVoidCandidate({ status: "LIVE", kickoffTs: NOW - DAY + 1 }, NOW)).toBe(false);
    expect(isVoidCandidate({ status: "LIVE", kickoffTs: NOW - DAY }, NOW)).toBe(false);
  });
});

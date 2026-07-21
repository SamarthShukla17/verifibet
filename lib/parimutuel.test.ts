import { describe, expect, it } from "vitest";
import { estimatePayout } from "@/lib/parimutuel";

describe("estimatePayout", () => {
  it("first bet on a brand-new market (all pools zero) gets even odds — exactly its own stake back", () => {
    expect(estimatePayout([0n, 0n, 0n], 2, 5_000_000n)).toBe(5_000_000n);
  });

  it("hand-computed: pools [100,50,50], bet 10 on home", () => {
    // winningPoolAfter = 100+10 = 110; totalPoolAfter = 200+10 = 210
    // payout = 10 * 210 / 110 = 2100 / 110 = 19 (floor)
    expect(estimatePayout([100n, 50n, 50n], 0, 10n)).toBe(19n);
  });

  it("betting into a currently-unstaked outcome wins the entire pool (single ticket in that outcome)", () => {
    // winningPoolAfter = 0+20 = 20; totalPoolAfter = 100+0+50+20 = 170
    // payout = 20 * 170 / 20 = 170
    expect(estimatePayout([100n, 0n, 50n], 1, 20n)).toBe(170n);
  });

  it("returns 0n for a non-positive amount rather than dividing by a possibly-zero denominator", () => {
    expect(estimatePayout([100n, 50n, 50n], 0, 0n)).toBe(0n);
    expect(estimatePayout([100n, 50n, 50n], 0, -10n)).toBe(0n);
    // Would-be division by zero if amount weren't short-circuited first:
    // pool for this outcome is 0 and amount is 0 -> denominator 0.
    expect(estimatePayout([0n, 0n, 0n], 1, 0n)).toBe(0n);
  });

  it("large real-world USDC base-unit magnitudes stay exact (BigInt, no float rounding)", () => {
    // winningPoolAfter = 2_000_000 + 1_000_000 = 3_000_000
    // totalPoolAfter = 5_000_000+3_000_000+2_000_000+1_000_000 = 11_000_000
    // payout = 1_000_000 * 11_000_000 / 3_000_000 = 11_000_000_000_000 / 3_000_000 = 3_666_666 (floor)
    expect(
      estimatePayout([5_000_000n, 3_000_000n, 2_000_000n], 2, 1_000_000n),
    ).toBe(3_666_666n);
  });

  it("never overestimates: the floor-division payout times the winning pool never exceeds the total pool after the bet", () => {
    const pools: [bigint, bigint, bigint] = [7_777_777n, 1_234_567n, 9_999_999n];
    const amount = 3_333_333n;
    const outcome = 1;
    const payout = estimatePayout(pools, outcome, amount);

    const winningPoolAfter = pools[outcome] + amount;
    const totalPoolAfter = pools[0] + pools[1] + pools[2] + amount;
    // The exact (non-floored) share, scaled up, must be >= payout * winningPoolAfter.
    expect(payout * winningPoolAfter).toBeLessThanOrEqual(amount * totalPoolAfter);
  });
});

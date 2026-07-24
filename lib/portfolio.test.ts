import { describe, expect, it } from "vitest";
import {
  claimablePositions,
  computePortfolioStats,
  filterPositionsForTab,
} from "@/lib/portfolio";
import type { Position, PositionStatus } from "@/lib/hooks/useMyBets";
import type { MarketStatus } from "@/lib/types";

let nextPda = 0;

/** Minimal, otherwise-irrelevant fields filled with fixed placeholders —
 * every test below only cares about `status`/`amount`/`payout`/
 * `marketStatus`, passed explicitly per case. */
function position(overrides: Partial<Position> & { status: PositionStatus }): Position {
  nextPda++;
  return {
    betPda: `bet-${nextPda}`,
    marketPda: `market-${nextPda}`,
    fixtureId: nextPda,
    home: "Home",
    away: "Away",
    stage: null,
    fixtureStatus: null,
    kickoffTs: 0,
    marketStatus: "OPEN",
    outcome: 0,
    pickLabel: "Home",
    amount: 0n,
    estPayout: null,
    payout: null,
    ...overrides,
  };
}

describe("computePortfolioStats", () => {
  it("all zero / empty for no positions", () => {
    expect(computePortfolioStats([])).toEqual({ activeStake: 0n, claimable: 0n, pnl: 0n, wins: 0, losses: 0 });
  });

  it("pending: sums into activeStake, never pnl/claimable, no W/L credit", () => {
    const stats = computePortfolioStats([
      position({ status: "pending", amount: 5_000_000n, marketStatus: "OPEN" }),
      position({ status: "pending", amount: 2_000_000n, marketStatus: "LOCKED" }),
    ]);
    expect(stats).toEqual({ activeStake: 7_000_000n, claimable: 0n, pnl: 0n, wins: 0, losses: 0 });
  });

  it("won (unclaimed): counts as claimable, a win, and profit = payout - amount", () => {
    const stats = computePortfolioStats([
      position({ status: "won", amount: 5_000_000n, payout: 7_000_000n, marketStatus: "RESOLVED" }),
    ]);
    expect(stats.claimable).toBe(7_000_000n);
    expect(stats.pnl).toBe(2_000_000n);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
  });

  it("lost: no claimable, pnl is the full stake as a loss, one L", () => {
    const stats = computePortfolioStats([
      position({ status: "lost", amount: 3_000_000n, payout: null, marketStatus: "RESOLVED" }),
    ]);
    expect(stats).toEqual({ activeStake: 0n, claimable: 0n, pnl: -3_000_000n, wins: 0, losses: 1 });
  });

  it("refundable: real claimable money, but neither a win nor a loss — pnl stays 0", () => {
    const stats = computePortfolioStats([
      position({ status: "refundable", amount: 4_000_000n, payout: 4_000_000n, marketStatus: "VOIDED" }),
    ]);
    expect(stats).toEqual({ activeStake: 0n, claimable: 4_000_000n, pnl: 0n, wins: 0, losses: 0 });
  });

  it("claimed via a win (marketStatus RESOLVED): counts as a realized win, not claimable anymore", () => {
    const stats = computePortfolioStats([
      position({ status: "claimed", amount: 5_000_000n, payout: 7_000_000n, marketStatus: "RESOLVED" }),
    ]);
    expect(stats).toEqual({ activeStake: 0n, claimable: 0n, pnl: 2_000_000n, wins: 1, losses: 0 });
  });

  it("claimed via a refund (marketStatus VOIDED): net zero, not a win, not claimable anymore", () => {
    const stats = computePortfolioStats([
      position({ status: "claimed", amount: 5_000_000n, payout: 5_000_000n, marketStatus: "VOIDED" }),
    ]);
    expect(stats).toEqual({ activeStake: 0n, claimable: 0n, pnl: 0n, wins: 0, losses: 0 });
  });

  it("a realistic mixed portfolio nets out correctly", () => {
    const stats = computePortfolioStats([
      position({ status: "pending", amount: 5_000_000n }),
      position({ status: "won", amount: 5_000_000n, payout: 7_000_000n, marketStatus: "RESOLVED" }),
      position({ status: "lost", amount: 2_000_000n, marketStatus: "RESOLVED" }),
      position({ status: "refundable", amount: 1_000_000n, payout: 1_000_000n, marketStatus: "VOIDED" }),
      position({ status: "claimed", amount: 3_000_000n, payout: 3_000_000n, marketStatus: "VOIDED" }),
      position({ status: "claimed", amount: 4_000_000n, payout: 10_000_000n, marketStatus: "RESOLVED" }),
    ]);
    expect(stats.activeStake).toBe(5_000_000n);
    expect(stats.claimable).toBe(7_000_000n + 1_000_000n);
    // won: +2, lost: -2, refundable: 0, refund-claimed: 0, win-claimed: +6
    expect(stats.pnl).toBe(2_000_000n - 2_000_000n + 6_000_000n);
    expect(stats.wins).toBe(2); // the won + the win-claimed
    expect(stats.losses).toBe(1);
  });
});

describe("filterPositionsForTab", () => {
  const all = [
    position({ status: "pending" }),
    position({ status: "won", marketStatus: "RESOLVED" }),
    position({ status: "lost", marketStatus: "RESOLVED" }),
    position({ status: "refundable", marketStatus: "VOIDED" }),
    position({ status: "claimed", marketStatus: "RESOLVED" }),
  ];

  it("active: only pending", () => {
    expect(filterPositionsForTab(all, "active").map((p) => p.status)).toEqual(["pending"]);
  });

  it("settled: everything that isn't pending", () => {
    expect(filterPositionsForTab(all, "settled").map((p) => p.status)).toEqual([
      "won",
      "lost",
      "refundable",
      "claimed",
    ]);
  });

  it("all: unfiltered, same length", () => {
    expect(filterPositionsForTab(all, "all")).toHaveLength(all.length);
  });

  it("does not mutate the input array", () => {
    const copy = [...all];
    filterPositionsForTab(all, "active");
    expect(all).toEqual(copy);
  });
});

describe("claimablePositions", () => {
  it("won and refundable only — not pending, lost, or already-claimed", () => {
    const all = [
      position({ status: "pending" }),
      position({ status: "won", marketStatus: "RESOLVED" }),
      position({ status: "lost", marketStatus: "RESOLVED" }),
      position({ status: "refundable", marketStatus: "VOIDED" }),
      position({ status: "claimed", marketStatus: "RESOLVED" }),
    ];
    expect(claimablePositions(all).map((p) => p.status)).toEqual(["won", "refundable"]);
  });

  it("empty for a portfolio with nothing claimable", () => {
    expect(claimablePositions([position({ status: "pending" })])).toEqual([]);
  });
});

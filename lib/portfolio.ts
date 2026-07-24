/**
 * Pure portfolio aggregation over a wallet's own `Position[]`
 * (`lib/hooks/useMyBets.ts`) — no I/O, no React, `bigint` throughout
 * (money math, see CLAUDE.md's bigint/never-floats convention).
 */
import { computeStreak } from "@/lib/parimutuel";
import type { Position } from "@/lib/hooks/useMyBets";

export interface PortfolioStats {
  /** Sum of `amount` across every still-`pending` position. Not "at
   * risk" in a loss sense — a pending bet's stake is already escrowed
   * on-chain regardless of this number — just "not decided yet". */
  activeStake: bigint;
  /** Sum of `payout` across every unclaimed `won`/`refundable` position —
   * real money already sitting in a vault, decided, just not claimed. */
  claimable: bigint;
  /**
   * Realized profit/loss, `payout - amount` per *settled* position,
   * summed. `pending` positions are excluded entirely (nothing's
   * realized yet); a void (`refundable`, or a `claimed` position whose
   * `marketStatus` is `VOIDED`) contributes exactly `0` — the exact
   * stake back is neither a win nor a loss, not "break-even profit".
   * `claimed` needs `marketStatus` to disambiguate which of the two
   * claim instructions produced it (see `useMyBets.ts`'s `classify` doc
   * comment for why that's always unambiguous) since `Position` itself
   * doesn't carry a separate "claimed via win vs. via refund" flag.
   */
  pnl: bigint;
  /** `won` + win-`claimed` positions. Void positions count as neither a
   * win nor a loss. */
  wins: number;
  losses: number;
  /** Consecutive wins counting back from the most recently *resolved*
   * position (`lib/parimutuel.ts`'s `computeStreak`) — same win/loss set
   * as `wins`/`losses` above (void positions excluded, not a break),
   * ordered by `resolvedAt`. `0` with no resolved wins at all, including
   * "most recent decided position was a loss" — this is a *current* win
   * streak, not a signed win/loss streak. */
  streak: number;
}

const ZERO_STATS: PortfolioStats = { activeStake: 0n, claimable: 0n, pnl: 0n, wins: 0, losses: 0, streak: 0 };

export function computePortfolioStats(positions: readonly Position[]): PortfolioStats {
  let activeStake = 0n;
  let claimable = 0n;
  let pnl = 0n;
  let wins = 0;
  let losses = 0;
  const results: { won: boolean; resolvedAt: number }[] = [];

  for (const p of positions) {
    switch (p.status) {
      case "pending":
        activeStake += p.amount;
        break;
      case "won":
        claimable += p.payout ?? 0n;
        pnl += (p.payout ?? 0n) - p.amount;
        wins++;
        results.push({ won: true, resolvedAt: p.resolvedAt });
        break;
      case "refundable":
        claimable += p.payout ?? 0n; // payout === amount — see PortfolioStats.pnl doc comment
        break;
      case "lost":
        pnl -= p.amount;
        losses++;
        results.push({ won: false, resolvedAt: p.resolvedAt });
        break;
      case "claimed":
        if (p.marketStatus !== "VOIDED") {
          pnl += (p.payout ?? 0n) - p.amount;
          wins++;
          results.push({ won: true, resolvedAt: p.resolvedAt });
        }
        break;
    }
  }

  return { activeStake, claimable, pnl, wins, losses, streak: computeStreak(results) };
}

/** Same instance every call for an empty list — a stable reference a
 * caller can safely use as a `useMemo`/`useState` default without
 * creating a fresh object each render. */
export function emptyPortfolioStats(): PortfolioStats {
  return ZERO_STATS;
}

export type PortfolioTab = "active" | "settled" | "all";

/** `active` = still `pending`; `settled` = everything that's been
 * decided one way or another (`won`/`lost`/`refundable`/`claimed`);
 * `all` = every position, unfiltered. The one place this filter is
 * defined, so the tabs and any stat derived "for the current tab" can't
 * drift from each other. */
export function filterPositionsForTab(positions: readonly Position[], tab: PortfolioTab): Position[] {
  if (tab === "all") return [...positions];
  if (tab === "active") return positions.filter((p) => p.status === "pending");
  return positions.filter((p) => p.status !== "pending");
}

/** `won`/`refundable` positions that haven't been claimed yet — exactly
 * what a "Claim All" affordance would iterate over once `claim_winnings`/
 * `claim_refund` are wired (Phase 6). */
export function claimablePositions(positions: readonly Position[]): Position[] {
  return positions.filter((p) => p.status === "won" || p.status === "refundable");
}

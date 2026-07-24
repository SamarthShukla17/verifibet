/**
 * Pure parimutuel payout math — no I/O, no React, no Solana imports.
 * `bigint` throughout (USDC base units, 6dp — see CLAUDE.md's
 * bigint/never-floats convention); this is money math, not display math.
 */
import type { MarketStatus, Outcome } from "@/lib/types";

/**
 * Estimates the payout a bet of `amount` on `outcome` would receive if
 * that outcome wins, given the market's *current* pools — i.e. "if I bet
 * this right now and nothing else changes, what do I get back". A real
 * parimutuel payout can only be known once betting closes (every other
 * bettor's stake between now and kickoff changes the denominator), so
 * this is explicitly an estimate, not a quote — callers should label it
 * that way (see `components/bet/BetSlip.tsx`'s "estimated — pools move
 * until kickoff").
 *
 * Standard parimutuel formula: winners split the *entire* pool (across
 * all three outcomes) in proportion to their share of the *winning*
 * outcome's pool, after this bet joins it:
 *
 *   payout = amount * (totalPool + amount) / (pools[outcome] + amount)
 *
 * `amount` is added to both the numerator (it's part of what gets split)
 * and the denominator (it's part of the winning pool it's a share of) —
 * this matters most right when a market is brand new (`pools` all
 * zero): the very first bet is 100% of both the winning pool and the
 * total pool, so it estimates getting exactly its own stake back (even
 * odds), not a division-by-zero or an inflated number from ignoring its
 * own contribution.
 *
 * Returns `0n` for a non-positive `amount` rather than dividing by a
 * `pools[outcome] + amount` that could be zero (defensive against a
 * caller passing a bad amount, not just a happy-path assumption) — never
 * throws for a value this function's own type signature already
 * excludes.
 *
 * Deliberately no on-chain fee/rake term: `resolve_market`/`claim_winnings`
 * (see `anchor/programs/verifibet/src/instructions/`) don't take one
 * either — a winner's real payout is exactly their proportional share of
 * `market.total_pool`, base units, no deduction. If that ever changes on
 * the program side, this estimate needs to change with it.
 */
export function estimatePayout(
  pools: readonly [bigint, bigint, bigint],
  outcome: Outcome,
  amount: bigint,
): bigint {
  if (amount <= 0n) return 0n;

  const winningPoolAfter = pools[outcome] + amount;
  const totalPoolAfter = pools[0] + pools[1] + pools[2] + amount;

  return (amount * totalPoolAfter) / winningPoolAfter;
}

/**
 * The exact on-chain formula (`claim_winnings.rs`'s `compute_payout`):
 * `stake * total_pool / winning_pool`, floored. Unlike `estimatePayout`
 * above, `amount` here is *already* part of `pools`/`totalPool` — this is
 * for a bet that's already been placed, not a hypothetical new one, so it
 * must not be added a second time.
 *
 * Used for two different labels over the same math (see
 * `lib/hooks/useMyBets.ts`): a live *estimate* while a market is still
 * OPEN/LOCKED (pools still move until kickoff), and the *actual* claimable
 * amount once RESOLVED — `claim_winnings.rs`'s own doc comment notes
 * `Market.pools`/`total_pool` are frozen at `resolve_market` and never
 * touched again, so this same formula against a resolved market's current
 * on-chain pools already *is* the real payout, not an approximation of it.
 *
 * `winningPool <= 0n` returns `0n` rather than dividing by zero — not
 * reachable for a bet that's actually part of that pool (a real bet's own
 * `amount` is always counted in `pools[outcome]`), but this function
 * shouldn't assume that invariant on the caller's behalf.
 */
export function computePayout(amount: bigint, totalPool: bigint, winningPool: bigint): bigint {
  if (winningPool <= 0n) return 0n;
  return (amount * totalPool) / winningPool;
}

/**
 * `pending` while the market hasn't resolved/voided yet; `won`/`lost`
 * once resolved (whichever `bet.outcome === market.outcome` decides);
 * `refundable` once voided; `claimed` — checked *before* any of the
 * above — once `bet.claimed` is true, regardless of which of the two
 * claim instructions (`claim_winnings` or `claim_refund`) actually set
 * it. Mutually exclusive and exhaustive: a losing bet can never become
 * `claimed` (`claim_winnings` on-chain requires `bet.outcome ===
 * market.outcome`, so `lost` is always terminal), and a market is never
 * simultaneously `Resolved` and `Voided`, so `claimed`'s own payout math
 * never has to guess which path produced it — the market's current
 * status says so unambiguously.
 */
export type SettlementStatus = "pending" | "won" | "lost" | "refundable" | "claimed";

export interface BetInput {
  outcome: Outcome;
  /** USDC base units, 6dp. */
  amount: bigint;
  claimed: boolean;
}

export interface MarketInput {
  status: Lowercase<MarketStatus>;
  /** `null` when unresolved (mirrors `Market.outcome`'s `OUTCOME_UNSET`
   * sentinel, already decoded to `null` by the caller). */
  outcome: Outcome | null;
  pools: readonly [bigint, bigint, bigint];
  totalPool: bigint;
}

export interface Settlement {
  status: SettlementStatus;
  /** Live "if resolved right now" estimate — only set while `pending`. */
  estPayout: bigint | null;
  /** The real, exact amount — set for `won`/`refundable`/`claimed`,
   * `null` for `pending` (no final number exists yet) and `lost`
   * (nothing to claim). */
  payout: bigint | null;
}

/**
 * The one place a `Bet` + its `Market` are classified into a settlement
 * outcome — shared by `lib/hooks/useMyBets.ts` (one connected wallet,
 * client-side) and `app/api/leaderboard/route.ts` (every wallet,
 * server-side) so "what does it mean for a bet to be won/lost/claimed"
 * can't drift between the two pages that both need to agree on it.
 */
export function classifyBet(bet: BetInput, market: MarketInput): Settlement {
  if (bet.claimed) {
    const payout =
      market.status === "voided" ? bet.amount : computePayout(bet.amount, market.totalPool, market.pools[bet.outcome]);
    return { status: "claimed", estPayout: null, payout };
  }

  if (market.status === "open" || market.status === "locked") {
    return {
      status: "pending",
      estPayout: computePayout(bet.amount, market.totalPool, market.pools[bet.outcome]),
      payout: null,
    };
  }

  if (market.status === "resolved") {
    if (market.outcome === bet.outcome) {
      return {
        status: "won",
        estPayout: null,
        payout: computePayout(bet.amount, market.totalPool, market.pools[bet.outcome]),
      };
    }
    return { status: "lost", estPayout: null, payout: null };
  }

  // voided
  return { status: "refundable", estPayout: null, payout: bet.amount };
}

export interface SettlementResult {
  won: boolean;
  /** Unix seconds — `Market.resolved_at`. */
  resolvedAt: number;
}

/**
 * Consecutive wins counting back from the most recently resolved result
 * — stops at the first loss (or the list's end). Callers exclude
 * void/refund outcomes before calling this (see `classifyBet`'s
 * `refundable`/void-`claimed` cases): those are neither a win nor a
 * loss, so this function only ever sees genuine win/loss results, never
 * has to decide what a void does to a streak.
 */
export function computeStreak(results: readonly SettlementResult[]): number {
  const sorted = [...results].sort((a, b) => b.resolvedAt - a.resolvedAt);
  let streak = 0;
  for (const result of sorted) {
    if (!result.won) break;
    streak++;
  }
  return streak;
}

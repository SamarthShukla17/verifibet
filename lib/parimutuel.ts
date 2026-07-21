/**
 * Pure parimutuel payout math — no I/O, no React, no Solana imports.
 * `bigint` throughout (USDC base units, 6dp — see CLAUDE.md's
 * bigint/never-floats convention); this is money math, not display math.
 */
import type { Outcome } from "@/lib/types";

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

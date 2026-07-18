//! `claim_winnings` — pays out a winning `Bet`'s proportional share of a
//! resolved market's total pool.
//!
//! Parimutuel settlement: each winning bettor gets
//! `stake * total_pool / winning_pool`, floored. `market` is deliberately
//! **not** `mut` here and its `pools`/`total_pool` are never touched by
//! this instruction — every claimant's payout has to be computed against
//! the same, unchanging pool totals that were fixed at `resolve_market`,
//! not against whatever's left after however many other claims have
//! already happened. Decrementing pools per-claim would make payout
//! depend on claim order, which is not parimutuel settlement.
//!
//! Flooring means the sum of every winning bet's payout is `<=`
//! `winning_pool`'s share of `total_pool`, never more — the rounding
//! remainder (at most `winning_pool - 1` base units across all winners,
//! typically far less) is not swept anywhere. It just stays in the vault
//! forever. That's deliberate: it's unclaimed dust, not a fund anyone is
//! specifically owed, and a sweep instruction would be its own attack
//! surface (a path for genuinely-unclaimed winnings to be swept out from
//! under a bettor who just hasn't claimed yet).
//!
//! Zero protocol fee: `compute_payout` below has no fee term. A fee switch
//! is plausible future work, but isn't implemented — every winning dollar
//! staked gets exactly its proportional share of the total pool, nothing
//! skimmed, which keeps this settlement math fully auditable without
//! needing to also reason about a fee schedule.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::VerifibetError;
use crate::state::{Bet, Market, MarketStatus, BET_SEED, MARKET_SEED};

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    pub user: Signer<'info>,

    /// Re-derived from the market's own stored `fixture_id`/`bump`, same
    /// as every other instruction that touches an existing `Market` — see
    /// `resolve_market.rs`. Not `mut`: see the module doc comment.
    #[account(
        seeds = [MARKET_SEED, market.fixture_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// Seeds re-derive this from the account's own stored `outcome`
    /// (`claim_winnings` takes no `outcome` argument — there's exactly one
    /// correct value, whatever this specific bet was placed on) against
    /// the *passed-in* `market`/`user` accounts, which already guarantees
    /// this bet belongs to both of them. `has_one = user` / `has_one =
    /// market` re-check the same thing the simpler way — redundant with
    /// the seeds constraint, kept anyway as an independent check that
    /// doesn't rely on the seeds derivation being bug-free.
    #[account(
        mut,
        seeds = [BET_SEED, market.key().as_ref(), user.key().as_ref(), &[bet.outcome]],
        bump = bet.bump,
        has_one = user,
        has_one = market,
    )]
    pub bet: Account<'info, Bet>,

    /// The market's escrow — identical constraints to `place_bet`'s
    /// `vault`: always the canonical ATA of `market` for `usdc_mint`, so
    /// there is no account that can redirect the payout elsewhere.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_usdc.mint == market.usdc_mint @ VerifibetError::MintMismatch,
        constraint = user_usdc.owner == user.key(),
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(address = market.usdc_mint @ VerifibetError::MintMismatch)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct WinningsClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub payout: u64,
}

/// Parimutuel payout: `stake * total_pool / winning_pool`, floored.
///
/// A u128 intermediate is required, not just nice-to-have: `amount *
/// total` can exceed `u64::MAX` even when the final payout fits back in a
/// u64 (e.g. a large pool with many small winners). `checked_mul` and
/// `checked_div` on the u128 catch overflow and division-by-zero;
/// `u64::try_from` catches the case where the u128 result is real but too
/// large to hand back as a u64 (which would only happen if `winning_pool`
/// were absurdly small relative to `total_pool`, since `payout <=
/// total_pool` whenever `winning_pool >= amount`, which is always true for
/// any legitimately-placed bet).
pub fn compute_payout(amount: u64, total: u64, winning: u64) -> Option<u64> {
    let payout = (amount as u128)
        .checked_mul(total as u128)?
        .checked_div(winning as u128)?;
    u64::try_from(payout).ok()
}

pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Resolved,
        VerifibetError::MarketNotResolved
    );
    require!(
        ctx.accounts.bet.outcome == ctx.accounts.market.outcome,
        VerifibetError::NotWinningBet
    );
    require!(!ctx.accounts.bet.claimed, VerifibetError::AlreadyClaimed);

    let winning_pool = ctx.accounts.market.pools[ctx.accounts.market.outcome as usize];
    let payout = compute_payout(
        ctx.accounts.bet.amount,
        ctx.accounts.market.total_pool,
        winning_pool,
    )
    .ok_or(VerifibetError::MathOverflow)?;

    // State-then-interaction: mark claimed before the transfer CPI below,
    // so there is no window in which a retried or re-entered call could
    // still see `claimed == false` and pay out twice.
    ctx.accounts.bet.claimed = true;

    let fixture_id_bytes = ctx.accounts.market.fixture_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[MARKET_SEED, &fixture_id_bytes, &[bump]]];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        payout,
        ctx.accounts.usdc_mint.decimals,
    )?;

    emit!(WinningsClaimed {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        payout,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floors_the_remainder() {
        // 100 * 1000 / 300 = 333.33... -> 333, not 334.
        assert_eq!(compute_payout(100, 1000, 300), Some(333));
    }

    #[test]
    fn everyone_right_returns_exact_stake() {
        // total_pool == winning_pool (every bettor picked the winning
        // outcome): payout must equal the original stake exactly, no gain
        // or loss from rounding.
        assert_eq!(compute_payout(500, 500, 500), Some(500));
        assert_eq!(compute_payout(1, 12_345, 12_345), Some(1));
    }

    #[test]
    fn zero_winning_pool_is_none_not_a_panic() {
        // Not reachable from `claim_winnings` in practice (a winning `Bet`
        // implies `winning_pool >= that bet's own amount > 0`), but the
        // pure function itself must never divide by zero regardless of
        // caller invariants.
        assert_eq!(compute_payout(100, 1000, 0), None);
    }

    #[test]
    fn zero_stake_is_zero_payout() {
        assert_eq!(compute_payout(0, 1000, 300), Some(0));
    }

    #[test]
    fn u128_intermediate_avoids_the_u64_multiply_overflow() {
        // amount * total overflows a u64 here but not a u128, and the
        // final result divides back down to something that fits in a u64.
        let amount = u64::MAX / 2;
        let total = u64::MAX;
        let winning = u64::MAX;
        assert_eq!(compute_payout(amount, total, winning), Some(amount));
    }

    #[test]
    fn final_downcast_overflow_is_none_not_a_panic() {
        // amount * total fits in u128, but dividing by a winning_pool this
        // small yields a value too large to downcast back into a u64.
        assert_eq!(compute_payout(u64::MAX, u64::MAX, 1), None);
    }
}

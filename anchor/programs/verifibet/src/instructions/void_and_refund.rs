//! `void_market` / `claim_refund` — the escape hatch for a market that can
//! no longer be resolved (TxLINE never produces a usable proof for the
//! fixture, the fixture itself is abandoned/corrupted upstream, etc.).
//! Voiding gives every bettor their exact stake back, on every outcome
//! side, with no winners or losers — unlike `resolve_market`, there's no
//! proportional payout to compute because a voided market never had a
//! winning outcome to be proportional *to*.
//!
//! `void_market` is deliberately not callable on demand: it requires
//! `Clock::get()?.unix_timestamp > kickoff_ts + VOID_GRACE_PERIOD_SECS`
//! (one day) on top of the usual `Open`/`Locked` status guard, so an
//! authority can't void a market that's simply still in-flight (the match
//! is still being played, or TxLINE's data for it just hasn't landed yet)
//! to dodge a resolution that would go against them. A day past kickoff is
//! long past any real match's final whistle.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::VerifibetError;
use crate::instructions::common;
use crate::state::{Bet, Market, MarketStatus, BET_SEED, MARKET_SEED};

/// One day, in seconds — see the module doc comment.
const VOID_GRACE_PERIOD_SECS: i64 = 86_400;

#[derive(Accounts)]
pub struct VoidMarket<'info> {
    #[account(constraint = authority.key() == market.authority @ VerifibetError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.fixture_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

/// Same shape as `claim_winnings.rs`'s `ClaimWinnings` — see that file for
/// why each constraint is there (identical reasoning applies here: the
/// `bet` seeds re-derive from its own stored `outcome` against the
/// passed-in `market`/`user`, `has_one` re-checks the same thing
/// independently, `vault`/`user_usdc`/`usdc_mint` close the same
/// wrong-mint/substituted-vault vectors). The only difference is which
/// status the market must be in and how much gets paid out — both are in
/// the handler below, not the accounts.
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    pub user: Signer<'info>,

    #[account(
        seeds = [MARKET_SEED, market.fixture_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [BET_SEED, market.key().as_ref(), user.key().as_ref(), &[bet.outcome]],
        bump = bet.bump,
        has_one = user,
        has_one = market,
    )]
    pub bet: Account<'info, Bet>,

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
pub struct VoidedMarket {
    pub market: Pubkey,
    pub fixture_id: u64,
}

#[event]
pub struct RefundClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub payout: u64,
}

pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    common::require_open_or_locked(market.status)?;
    require!(
        Clock::get()?.unix_timestamp > market.kickoff_ts + VOID_GRACE_PERIOD_SECS,
        VerifibetError::TooEarlyToVoid
    );

    market.status = MarketStatus::Voided;

    emit!(VoidedMarket {
        market: market.key(),
        fixture_id: market.fixture_id,
    });

    Ok(())
}

pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Voided,
        VerifibetError::MarketNotVoided
    );
    require!(!ctx.accounts.bet.claimed, VerifibetError::AlreadyClaimed);

    // Exact stake back, not a proportional share — a voided market never
    // resolved to a winning outcome, so there's no winning pool to be
    // proportional to. Every bet, on every outcome side, is refunded in
    // full, unconditionally on `bet.outcome`.
    let payout = ctx.accounts.bet.amount;

    // State-then-interaction — see claim_winnings.rs.
    ctx.accounts.bet.claimed = true;

    common::transfer_from_vault(
        &ctx.accounts.market,
        &ctx.accounts.vault,
        &ctx.accounts.user_usdc,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.token_program,
        payout,
    )?;

    emit!(RefundClaimed {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        payout,
    });

    Ok(())
}

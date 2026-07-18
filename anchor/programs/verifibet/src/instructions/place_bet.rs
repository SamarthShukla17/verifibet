//! `place_bet` — stakes USDC on one outcome of an open market.
//!
//! The account constraints here close four attack vectors:
//!
//! 1. **Wrong-mint account.** `user_usdc.mint == market.usdc_mint` (tagged
//!    `@ MintMismatch`) stops a bettor funding a bet from a token account
//!    for some other mint. That alone isn't quite enough — a caller could
//!    also pass a fake `usdc_mint` account that happens to match their fake
//!    `user_usdc.mint` — so `usdc_mint` is independently pinned via
//!    `address = market.usdc_mint` (also `@ MintMismatch`), tying both
//!    accounts back to the one mint `initialize_market` committed to.
//! 2. **Substituted vault.** `vault` is re-derived every call from
//!    `associated_token::mint = usdc_mint, associated_token::authority =
//!    market` — the same canonical-ATA rule `initialize_market` used to
//!    create it (see the PDA-scheme comment in `state.rs`). There is no
//!    account that satisfies that constraint other than the market's one
//!    true vault, so funds can't be redirected to an attacker-controlled
//!    token account by passing a different `vault`.
//! 3. **Post-kickoff bet.** `Clock::get()?.unix_timestamp < market.kickoff_ts`
//!    is enforced on-chain on every call, not just checked client-side — a
//!    bet can't land after kickoff even if it was submitted (but not yet
//!    confirmed) right before it.
//! 4. **Outcome overwrite via `init_if_needed`.** `init_if_needed` only
//!    runs its `init` logic the first time this PDA is created; every
//!    later call just loads the existing account as-is with none of the
//!    `init`-time checks re-run. Without the `bet.amount == 0` branch
//!    below re-asserting `bet.user` / `bet.market` / `bet.outcome`, any
//!    future bug that let this PDA be reached with different logical
//!    inputs than the ones that originally created it (bump collision, a
//!    later instruction reusing the seed scheme incorrectly, ...) could
//!    silently mutate a position belonging to a different market, user, or
//!    outcome than the one this specific call validated. The re-check
//!    makes that impossible regardless of how the account got there,
//!    rather than trusting the PDA derivation alone.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::errors::VerifibetError;
use crate::state::{Bet, Market, MarketStatus, BET_SEED, MARKET_SEED};

#[derive(Accounts)]
#[instruction(outcome: u8)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Re-derived from the market's own stored `fixture_id`/`bump` (not an
    /// instruction arg — `place_bet` doesn't take one) so this is
    /// guaranteed to be the canonical PDA for whatever fixture it claims,
    /// not just any `Market`-typed account.
    #[account(
        mut,
        seeds = [MARKET_SEED, market.fixture_id.to_le_bytes().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// One position per `(market, user, outcome)`. Re-betting the same
    /// outcome reuses this same PDA and accumulates into `amount`; betting
    /// a different outcome opens a distinct `Bet` PDA (see `state.rs`).
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Bet::INIT_SPACE,
        seeds = [BET_SEED, market.key().as_ref(), user.key().as_ref(), &[outcome]],
        bump,
    )]
    pub bet: Account<'info, Bet>,

    #[account(
        mut,
        constraint = user_usdc.mint == market.usdc_mint @ VerifibetError::MintMismatch,
        constraint = user_usdc.owner == user.key(),
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(address = market.usdc_mint @ VerifibetError::MintMismatch)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    /// Required by `init_if_needed` on `bet` above, even though it's not
    /// otherwise touched in this instruction.
    pub system_program: Program<'info, System>,
    /// Required by Anchor's `associated_token::*` constraint resolution on
    /// `vault` above (not otherwise touched — the vault already exists).
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub user: Pubkey,
    pub outcome: u8,
    pub amount: u64,
    pub pools: [u64; 3],
}

pub fn place_bet(ctx: Context<PlaceBet>, outcome: u8, amount: u64) -> Result<()> {
    require!(outcome < 3, VerifibetError::InvalidOutcome);
    require!(amount > 0, VerifibetError::ZeroAmount);
    require!(
        ctx.accounts.market.status == MarketStatus::Open,
        VerifibetError::MarketNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp < ctx.accounts.market.kickoff_ts,
        VerifibetError::KickoffPassed
    );

    let bet = &mut ctx.accounts.bet;
    if bet.amount == 0 {
        // First stake on this (market, user, outcome) — either genuinely
        // fresh (init_if_needed just created it) or, in principle, an
        // all-zero existing account, which is unreachable in practice since
        // ZeroAmount rejects every deposit that would leave it that way.
        bet.user = ctx.accounts.user.key();
        bet.market = ctx.accounts.market.key();
        bet.outcome = outcome;
        bet.bump = ctx.bumps.bet;
    } else {
        // Re-bet on an existing position: init_if_needed does NOT re-run
        // the branch above, so re-assert the invariants the PDA seeds are
        // supposed to already guarantee rather than trusting them blindly.
        require_keys_eq!(bet.user, ctx.accounts.user.key(), VerifibetError::Unauthorized);
        require_keys_eq!(
            bet.market,
            ctx.accounts.market.key(),
            VerifibetError::Unauthorized
        );
        require!(bet.outcome == outcome, VerifibetError::InvalidOutcome);
    }

    bet.amount = bet
        .amount
        .checked_add(amount)
        .ok_or(VerifibetError::MathOverflow)?;

    let market = &mut ctx.accounts.market;
    market.pools[outcome as usize] = market.pools[outcome as usize]
        .checked_add(amount)
        .ok_or(VerifibetError::MathOverflow)?;
    market.total_pool = market
        .total_pool
        .checked_add(amount)
        .ok_or(VerifibetError::MathOverflow)?;
    let pools = market.pools;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    emit!(BetPlaced {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        outcome,
        amount,
        pools,
    });

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::errors::VerifibetError;
use crate::state::{Market, MarketStatus, MARKET_SEED, OUTCOME_UNSET};

#[derive(Accounts)]
#[instruction(fixture_id: u64)]
pub struct InitializeMarket<'info> {
    /// Keeper wallet creating the market. Pays for both the market account
    /// and the vault's rent here, so the first bettor never has to.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, &fixture_id.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// Pinned into `market.usdc_mint` below. Every later token-moving
    /// instruction re-checks its own mint account against that field
    /// rather than trusting whatever's passed in — see
    /// `VerifibetError::MintMismatch`.
    pub usdc_mint: Account<'info, Mint>,

    /// The market's escrow. Always the canonical associated token account
    /// of `market` for `usdc_mint` — created here (not lazily on the first
    /// bet) so the first bettor doesn't pay the vault's rent, and so there
    /// is exactly one valid vault address per market by construction.
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct MarketInitialized {
    pub fixture_id: u64,
    pub market: Pubkey,
    pub kickoff_ts: i64,
}

pub fn initialize_market(
    ctx: Context<InitializeMarket>,
    fixture_id: u64,
    home: String,
    away: String,
    kickoff_ts: i64,
) -> Result<()> {
    // Byte length, not char count: this has to match what `#[max_len(24)]`
    // reserved in `Market::INIT_SPACE` (4 + 24 bytes per string), and
    // `String::len()` is bytes — the same thing Borsh actually serializes.
    // A `.chars().count()` check would under-count multi-byte UTF-8 team
    // names and still overflow the account on write.
    require!(home.len() <= 24, VerifibetError::NameTooLong);
    require!(away.len() <= 24, VerifibetError::NameTooLong);
    require!(
        kickoff_ts > Clock::get()?.unix_timestamp,
        VerifibetError::KickoffPassed
    );

    let market = &mut ctx.accounts.market;
    market.authority = ctx.accounts.authority.key();
    market.usdc_mint = ctx.accounts.usdc_mint.key();
    market.fixture_id = fixture_id;
    market.home = home;
    market.away = away;
    market.kickoff_ts = kickoff_ts;
    market.status = MarketStatus::Open;
    market.outcome = OUTCOME_UNSET;
    market.pools = [0; 3];
    market.total_pool = 0;
    market.proof_hash = [0; 32];
    market.resolved_at = 0;
    market.bump = ctx.bumps.market;

    emit!(MarketInitialized {
        fixture_id,
        market: market.key(),
        kickoff_ts,
    });

    Ok(())
}

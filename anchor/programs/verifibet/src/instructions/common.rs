//! Helpers shared by more than one instruction — factored out once actual
//! duplication started to itch, not speculatively: `require_open_or_locked`
//! was already repeated in `resolve_market`'s two handlers before
//! `void_market` needed the identical guard a third time, and
//! `transfer_from_vault` is the exact same market-PDA-signed CPI both
//! `claim_winnings` and `claim_refund` need, differing only in how the
//! `amount` they pass in was computed.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::VerifibetError;
use crate::state::{Market, MarketStatus, MARKET_SEED};

/// `status` must be `Open` or `Locked` — the set of statuses a market can
/// still transition out of before it's either resolved or voided. Used by
/// `resolve_market`, its `manual-fallback` twin, and `void_market`.
pub fn require_open_or_locked(status: MarketStatus) -> Result<()> {
    require!(
        matches!(status, MarketStatus::Open | MarketStatus::Locked),
        VerifibetError::MarketNotOpen
    );
    Ok(())
}

/// Moves `amount` out of a market's escrow vault to `user_usdc`, signed by
/// the market PDA — the only way funds ever leave a vault. Used by
/// `claim_winnings` (a proportional payout) and `claim_refund` (an exact
/// stake refund); the two differ only in how `amount` was computed before
/// calling this, not in how it moves. Signer seeds mirror the `Market` PDA
/// scheme exactly (see `state.rs`): `[MARKET_SEED, fixture_id LE, bump]`.
pub fn transfer_from_vault<'info>(
    market: &Account<'info, Market>,
    vault: &Account<'info, TokenAccount>,
    user_usdc: &Account<'info, TokenAccount>,
    usdc_mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let fixture_id_bytes = market.fixture_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[MARKET_SEED, &fixture_id_bytes, &[market.bump]]];

    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: usdc_mint.to_account_info(),
                to: user_usdc.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        usdc_mint.decimals,
    )
}

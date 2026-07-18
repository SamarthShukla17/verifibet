use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use instructions::*;

declare_id!("6UT3c81UNdkqxnMHBHHggjVXmb7eeonTmeYfeZ3fLc73");

#[program]
pub mod verifibet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        fixture_id: u64,
        home: String,
        away: String,
        kickoff_ts: i64,
    ) -> Result<()> {
        instructions::initialize_market(ctx, fixture_id, home, away, kickoff_ts)
    }

    pub fn place_bet(ctx: Context<PlaceBet>, outcome: u8, amount: u64) -> Result<()> {
        instructions::place_bet(ctx, outcome, amount)
    }
}

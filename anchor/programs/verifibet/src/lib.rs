use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use instructions::*;

declare_id!("4jBNaT9zGYE6j3wbiLEsJAP9twbszxYiMnZxsd7ZjRKt");

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
}

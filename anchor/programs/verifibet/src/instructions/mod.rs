use anchor_lang::prelude::*;

pub mod initialize_market;
pub mod place_bet;

pub use initialize_market::*;
pub use place_bet::*;

#[derive(Accounts)]
pub struct Initialize {}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    msg!("Greetings from: {:?}", ctx.program_id);
    Ok(())
}

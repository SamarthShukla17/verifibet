use anchor_lang::prelude::*;

pub mod claim_winnings;
pub mod common;
pub mod initialize_market;
pub mod place_bet;
pub mod resolve_market;
pub mod void_and_refund;

pub use claim_winnings::*;
pub use initialize_market::*;
pub use place_bet::*;
pub use resolve_market::*;
pub use void_and_refund::*;

#[derive(Accounts)]
pub struct Initialize {}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    msg!("Greetings from: {:?}", ctx.program_id);
    Ok(())
}

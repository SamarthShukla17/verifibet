use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use instructions::*;

declare_id!("9ybGXhWNp5SbPkxiiewwbXXU2iLsXApbDBiLTVrbomzM");

#[program]
pub mod verifibet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }
}

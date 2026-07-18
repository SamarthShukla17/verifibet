use anchor_lang::prelude::*;

#[error_code]
pub enum VerifibetError {
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Kickoff has already passed")]
    KickoffPassed,
    #[msg("Kickoff has not passed yet")]
    KickoffNotPassed,
    #[msg("Outcome must be 0 (home), 1 (draw), or 2 (away)")]
    InvalidOutcome,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Market is not voided")]
    MarketNotVoided,
    #[msg("Bet did not win")]
    NotWinningBet,
    #[msg("Bet has already been claimed")]
    AlreadyClaimed,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Too early to void this market")]
    TooEarlyToVoid,
    #[msg("Token account mint does not match the market's usdc_mint")]
    MintMismatch,
    #[msg("Team name exceeds 24 bytes")]
    NameTooLong,
}

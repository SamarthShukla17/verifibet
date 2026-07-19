//! Local-validator stand-in for TxLINE's `validate_stat`, used only under
//! `verifibet`'s `test-mock-txline` feature (see lib.rs there) so
//! `resolve_market`'s CPI has something to call on localnet — the real
//! TxLINE program only exists on devnet/mainnet. Matches the real
//! `validate_stat` instruction's argument layout field-for-field (order and
//! Borsh-serialized type, not names) so a CPI encoded against the real IDL
//! deserializes here identically; Anchor derives this program's instruction
//! discriminator from the literal name `validate_stat`, which is exactly
//! the same sighash the real IDL ships (confirmed: sha256("global:validate_stat")[..8]
//! == the real IDL's discriminator), so no manual byte-matching is needed.
//!
//! Always returns `Ok(())` — matching the real program's "no `returns`
//! field, failure is purely `Err`" behavior documented in
//! `resolve_market.rs` — *unless* `ts == FORCE_FAIL_TS`, a sentinel no real
//! timestamp would ever take, in which case it errors. That's the only
//! test hook: `resolve_market`'s CPI call passes its `ts` arg straight
//! through unmodified, so a test can force the CPI (and therefore the
//! whole `resolve_market` transaction) to fail without needing a second
//! instruction or a changed interface.
use anchor_lang::prelude::*;

declare_id!("DAkcQvNeL4zHoMikfi6rqTf9cQ3SSbBMHM15DLM8sikR");

/// Sentinel `ts` value that forces `validate_stat` to fail. No real unix-ms
/// timestamp is ever negative, matching the `OUTCOME_UNSET`-style sentinel
/// convention used elsewhere in this workspace (see verifibet's `state.rs`).
pub const FORCE_FAIL_TS: i64 = -1;

#[program]
pub mod mock_txline {
    use super::*;

    pub fn validate_stat(
        _ctx: Context<ValidateStat>,
        ts: i64,
        _fixture_summary: ScoresBatchSummary,
        _fixture_proof: Vec<ProofNode>,
        _main_tree_proof: Vec<ProofNode>,
        _predicate: TraderPredicate,
        _stat_a: StatTerm,
        _stat_b: Option<StatTerm>,
        _op: Option<BinaryExpression>,
    ) -> Result<()> {
        require!(ts != FORCE_FAIL_TS, MockTxLineError::ForcedFailure);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ValidateStat<'info> {
    /// CHECK: mock never reads this — the real program's own `validate_stat`
    /// has exactly this one account (confirmed via `cargo expand` on the
    /// real IDL, see resolve_market.rs), unchecked here since this stand-in
    /// doesn't implement Merkle verification.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
}

#[error_code]
pub enum MockTxLineError {
    #[msg("mock-txline: forced failure requested via sentinel ts")]
    ForcedFailure,
}

// Field-for-field copies of the real IDL's argument types (see
// idls/txline_validate.json) — Borsh only cares about layout, not type
// identity across crates, so a CPI built against verifibet's
// `txline_validate::types::*` deserializes into these correctly.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

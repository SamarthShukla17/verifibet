use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use instructions::*;

declare_id!("ChjuDZUnA5P9za6YjuMe6KYzwuDb6Y4mGacRWMvHCBPR");

// Typed CPI bindings for TxLINE's `validate_stat`, generated from
// anchor/idls/txline_validate.json — a trimmed copy of the fetched devnet
// IDL (anchor/idls/txline.json) containing only `validate_stat` and its
// argument types. Trimmed for two reasons, not just size: (1) the full IDL's
// `expose_structs` instruction has zero accounts, and Anchor 0.30.1's
// `declare_program!` matches "composite" (nested) account groups structurally
// by comparing account lists rather than by name — any other instruction
// with an empty nested accounts group collides with `expose_structs` and
// fails to compile with "struct takes 0 lifetime arguments but 1 lifetime
// argument was supplied" (confirmed by bisecting with cargo-expand, not
// guessed); (2) the full IDL's `constants` include two `pubkey`-typed
// values, and `declare_program!` emits their raw base58 string as a bare
// Rust expression instead of a `pubkey!(...)` call, which also fails to
// compile. Neither bug is reachable once trimmed to just `validate_stat`.
// `anchor/idls/txline.json` itself is untouched — `scripts/txline-*.ts`
// still read the full IDL for the `subscribe` flow.
declare_program!(txline_validate);

// Anchor 0.30.1's `#[program]` macro parses every `pub fn` inside the mod
// unconditionally when generating its own auxiliary code (client-accounts
// glue, dispatch), regardless of a `#[cfg(...)]` attribute on an individual
// method — confirmed empirically: cfg-gating just `resolve_market_attested`
// itself compiles fine with the feature on, but fails with `manual-fallback`
// off ("could not find `__client_accounts_attested` in the crate root"),
// because `#[program]` still tries to reference accounts::ResolveMarketAttested
// even though that type was correctly cfg'd away. `macro_rules!` expansion
// happens as its own step before `#[program]` ever sees the module, so
// invoking this with or without the extra method reliably produces a fully
// resolved module either way, unlike cfg-gating a method inside it directly.
macro_rules! verifibet_program {
    ($($extra:item)*) => {
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

            pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
                instructions::lock_market(ctx)
            }

            #[allow(clippy::too_many_arguments)]
            pub fn resolve_market(
                ctx: Context<ResolveMarket>,
                outcome: u8,
                ts: i64,
                fixture_summary: txline_validate::types::ScoresBatchSummary,
                fixture_proof: Vec<txline_validate::types::ProofNode>,
                main_tree_proof: Vec<txline_validate::types::ProofNode>,
                stat_home: txline_validate::types::StatTerm,
                stat_away: txline_validate::types::StatTerm,
            ) -> Result<()> {
                instructions::resolve_market(
                    ctx,
                    outcome,
                    ts,
                    fixture_summary,
                    fixture_proof,
                    main_tree_proof,
                    stat_home,
                    stat_away,
                )
            }

            pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
                instructions::claim_winnings(ctx)
            }

            pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
                instructions::void_market(ctx)
            }

            pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
                instructions::claim_refund(ctx)
            }

            $($extra)*
        }
    };
}

#[cfg(not(feature = "manual-fallback"))]
verifibet_program!();

/// See the doc comment on `instructions::resolve_market::resolve_market_attested`
/// — contingency only, not part of the submission build. Only compiled in
/// with `--features manual-fallback`.
#[cfg(feature = "manual-fallback")]
verifibet_program!(
    pub fn resolve_market_attested(
        ctx: Context<ResolveMarketAttested>,
        outcome: u8,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::resolve_market_attested(ctx, outcome, proof_hash)
    }
);

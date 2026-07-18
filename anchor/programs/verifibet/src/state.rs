use anchor_lang::prelude::*;

/// PDA seeds for all VERIFIBET on-chain accounts. Derived here and only
/// here — mirror exactly in `lib/solana/pda.ts` (see CLAUDE.md conventions).
///
/// - `Market` PDA: `[MARKET_SEED, fixture_id.to_le_bytes()]` — one Market
///   per TxLINE fixture, deterministic from the fixture id alone so it can
///   be derived off-chain before the account exists.
/// - `Bet` PDA: `[BET_SEED, market.key(), user.key(), [outcome]]` — one
///   position per `(user, outcome)` pair per market, not one per bet:
///   staking the same outcome on the same market again re-uses the same
///   PDA and accumulates into `amount` rather than creating a second
///   position. Staking a *different* outcome on the same market opens a
///   distinct `Bet` PDA — a user can hold positions on multiple outcomes
///   of the same market simultaneously.
/// - Escrow vault: never a freestanding PDA of its own — always the
///   canonical associated token account of the `Market` PDA for
///   `usdc_mint`, enforced via `associated_token::authority = market,
///   associated_token::mint = usdc_mint` constraints in every instruction
///   that touches it. There is exactly one valid vault address per market;
///   this closes off vault-substitution bugs by construction rather than
///   by a manual `constraint = ...` check that a future instruction could
///   forget to add.
pub const MARKET_SEED: &[u8] = b"market";
pub const BET_SEED: &[u8] = b"bet";

/// Sentinel for `Market.outcome` before the market is resolved.
pub const OUTCOME_UNSET: u8 = 255;

#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Keeper authority allowed to lock/resolve/void this market. Checked
    /// per-instruction against this field — never assumed to be a fixed,
    /// program-wide admin key.
    pub authority: Pubkey,
    /// USDC mint pinned at `initialize_market`. Every token-moving
    /// instruction re-checks accounts against this field rather than
    /// trusting whatever mint is passed in — see `VerifibetError::MintMismatch`.
    pub usdc_mint: Pubkey,
    /// TxLINE fixture id. Also the seed that derives this account's own
    /// address, so it's redundant with the PDA itself but kept as a field
    /// for cheap reads without re-deriving.
    pub fixture_id: u64,
    #[max_len(24)]
    pub home: String,
    #[max_len(24)]
    pub away: String,
    pub kickoff_ts: i64,
    /// Open, Locked, Resolved, Voided.
    pub status: MarketStatus,
    /// 0 = home, 1 = draw, 2 = away, 255 = unset (`OUTCOME_UNSET`) —
    /// matches the encoding documented in CLAUDE.md / `lib/types.ts`'s
    /// `Outcome`.
    pub outcome: u8,
    /// Total USDC staked per outcome index (0/1/2), base units.
    pub pools: [u64; 3],
    /// `pools[0] + pools[1] + pools[2]`, kept redundantly so the frontend
    /// doesn't need to sum on every read. Instructions that mutate `pools`
    /// must keep this in sync in the same transaction.
    pub total_pool: u64,
    /// Settlement proof (e.g. a TxLINE Merkle root) backing the resolved
    /// outcome. All-zero while unresolved.
    pub proof_hash: [u8; 32],
    /// Unix seconds the market was resolved at; `0` while unresolved.
    pub resolved_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Open,
    Locked,
    Resolved,
    Voided,
}

#[account]
#[derive(InitSpace)]
pub struct Bet {
    pub user: Pubkey,
    pub market: Pubkey,
    /// 0 = home, 1 = draw, 2 = away — never `OUTCOME_UNSET`; a `Bet`
    /// account only ever exists for a specific staked outcome.
    pub outcome: u8,
    /// Cumulative USDC staked on this `(user, outcome)` position, base
    /// units. Re-bets on the same outcome add to this rather than opening
    /// a new account.
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

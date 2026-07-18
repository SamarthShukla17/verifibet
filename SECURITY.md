# VERIFIBET security audit

Self-audit of `anchor/programs/verifibet/src/` against a Neodyme/OtterSec-style
Solana program checklist. Every row below was verified against the actual
source (file:line), not assumed from design intent — where a check passes,
the table cites the exact constraint that makes it pass; where it didn't,
the fix is described and applied in the same commit as this document.

Scope: the on-chain program only (`anchor/programs/verifibet/src/`). Not in
scope: the TxLINE program itself (trusted external dependency — see
`resolve_market.rs`'s module doc comment for the trust boundary that
implies), the frontend, and the keeper bot.

**Result: 2 findings, both fixed, both low/low-medium severity, neither
independently exploitable for fund loss as filed.** Everything else on the
checklist passed on first read with no code changes required — the
evidence for each pass is below, not just the verdict.

## Checklist

| # | Check | Status | Evidence (file:line) |
|---|-------|--------|----------------------|
| 1 | Every token account constrained by mint AND owner/associated_token | ✅ Pass | `vault` (escrow, 4 instructions): `associated_token::mint`/`associated_token::authority` — `initialize_market.rs:40-41`, `place_bet.rs:86-87`, `claim_winnings.rs:70-71`, `void_and_refund.rs:69-70`. `user_usdc` (3 instructions): `constraint = user_usdc.mint == market.usdc_mint` + `constraint = user_usdc.owner == user.key()` — `place_bet.rs:76-77`, `claim_winnings.rs:77-78`, `void_and_refund.rs:76-77`. |
| 2 | Vault constraints byte-identical across init/bet/claim/refund | ✅ Pass | Core two lines (`associated_token::mint = usdc_mint`, `associated_token::authority = market`) are character-for-character identical in all four: `initialize_market.rs:40-41`, `place_bet.rs:86-87`, `claim_winnings.rs:70-71`, `void_and_refund.rs:69-70`. Only `init, payer = authority` vs `mut` differs, which is correct (create vs. reference). |
| 3 | `usdc_mint` pinned at init, re-checked via `address = market.usdc_mint` everywhere after | ✅ Pass | Pinned: `initialize_market.rs:78` (`market.usdc_mint = ctx.accounts.usdc_mint.key()`). Re-checked: `place_bet.rs:81`, `claim_winnings.rs:82`, `void_and_refund.rs:81` — all `#[account(address = market.usdc_mint @ VerifibetError::MintMismatch)]`. |
| 4 | PDA-signed transfers only in claim/refund; seed order + bump correct | ✅ Pass | Only `common::transfer_from_vault` (`common.rs:32-56`) uses `CpiContext::new_with_signer`; called only from `claim_winnings.rs:137` and `void_and_refund.rs:146`. `place_bet.rs:160` (`CpiContext::new`, `authority: user`) and `resolve_market.rs:249` (`CpiContext::new`, no vault touched) are plain, unsigned CPIs — correct, since the user signs their own deposit directly and the TxLINE CPI doesn't move funds at all. Signer seeds (`common.rs:41`): `&[MARKET_SEED, &fixture_id_bytes, &[market.bump]]` — matches the `Market` PDA's own derivation (`seeds = [MARKET_SEED, fixture_id LE]`, `state.rs:24`) with the stored `bump` appended last, the required `create_program_address` convention. |
| 5 | All arithmetic `checked_*`; payout via u128 | ⚠️ 2 findings, both fixed | See [Findings](#findings) below. `compute_payout` (`claim_winnings.rs:106-111`): u128 intermediate, `checked_mul`/`checked_div`/`try_from`, 6 unit tests. `place_bet.rs:146,151,155`: `checked_add` on `bet.amount`/`pools[outcome]`/`total_pool`. Both were clean; the two findings were elsewhere. |
| 6 | Status machine is a DAG; every handler asserts entry state | ✅ Pass, with one documented judgment call | Every write: `initialize_market.rs:83` (→ Open, root), `resolve_market.rs:197` (Open → Locked, `lock_market`), `resolve_market.rs:275` / `:361` (Open\|Locked → Resolved), `void_and_refund.rs:120` (Open\|Locked → Voided). No write ever sets a market back to Open or Locked — no back-edges. Every handler that touches an existing market asserts its own entry state first: `place_bet.rs:113` (Open), `resolve_market.rs:212`/`:352` (`common::require_open_or_locked`), `void_and_refund.rs:103` (same), `claim_winnings.rs:115` (Resolved), `void_and_refund.rs:132` (Voided). **Judgment call**: `resolve_market` accepts Open *or* Locked, not strictly requiring `lock_market` first — this is intentional, not a gap: `place_bet` is independently gated by `kickoff_ts` (`place_bet.rs:117`), which `resolve_market` also requires to have passed (`resolve_market.rs:214`), so no bet can land in the window `resolve_market` would need `Locked` to close. `Locked` is a keeper-facing "stop taking bets now" signal, not the only thing preventing a late bet. |
| 7 | `Clock` uses `unix_timestamp` only | ✅ Pass | Every `Clock::get()` call in the program accesses `.unix_timestamp` and nothing else — `initialize_market.rs:72`, `place_bet.rs:117`, `resolve_market.rs:214,276,354`, `void_and_refund.rs:116` (post-fix). No use of `.slot`, `.epoch`, or any other `Clock` field anywhere in `instructions/*.rs`. |
| 8 | `Bet` `init_if_needed` cannot overwrite `user`/`market`/`outcome` | ✅ Pass | `place_bet.rs:122-139`: `if bet.amount == 0` (fresh) sets the three fields once; the `else` branch (re-bet) re-asserts them with `require_keys_eq!(bet.user, ...)` / `require_keys_eq!(bet.market, ...)` (`place_bet.rs:135-139`) and `require!(bet.outcome == outcome, ...)` (`place_bet.rs:141`) instead of trusting the existing values or re-writing them. |
| 9 | Resolve impossible pre-kickoff; claim impossible pre-resolve; refund impossible unless Voided | ✅ Pass | Resolve: `require!(Clock::get()?.unix_timestamp > market.kickoff_ts, KickoffNotPassed)` — `resolve_market.rs:214` (and `:354` for the `manual-fallback` twin). Claim: `require!(market.status == MarketStatus::Resolved, MarketNotResolved)` — `claim_winnings.rs:115`. Refund: `require!(market.status == MarketStatus::Voided, MarketNotVoided)` — `void_and_refund.rs:132`. |
| 10 | No `mut` account missing `seeds`/`has_one` | ✅ Pass | Every `#[account(mut, ...)]` on a non-`Signer` account carries `seeds`+`bump` (all `market`/`bet` fields — e.g. `resolve_market.rs:125-126`, `place_bet.rs:69-70`) or `associated_token::mint`+`associated_token::authority` (all `vault` fields) or `constraint = ... mint ... / ... owner ...` (all `user_usdc` fields). `has_one = user, has_one = market` additionally on `bet` in `claim_winnings.rs:60-61` and `void_and_refund.rs:62-63`. The one `mut` account with none of these is `authority`/`user` when they're the rent payer for an `init`/`init_if_needed` (`initialize_market.rs:15-16`, `place_bet.rs:48-49`) — correct, a `Signer`'s own signature is its authorization, no PDA constraint applies. |

## Findings

### F1 — Unclamped `ts` cast in `daily_scores_merkle_roots` seeds (Low)

**File:** `instructions/resolve_market.rs`, `ResolveMarket.daily_scores_merkle_roots` seeds (now fixed at line 163)

```rust
seeds = [b"daily_scores_roots", &((ts / MS_PER_DAY) as u16).to_le_bytes()],
```

`ts: i64` is a keeper-supplied instruction argument. For a negative or
absurdly large `ts`, `ts / MS_PER_DAY` can fall outside `0..=u16::MAX`, and
the `as u16` cast **truncates silently** instead of erroring — the one
piece of arithmetic in the program that wasn't using a checked/well-defined
path.

**Why it's Low, not higher:** not independently exploitable. A wrapped
epoch day almost certainly doesn't match any `daily_scores_merkle_roots`
account TxLINE actually maintains, so the account constraint simply fails
closed. TxLINE's own `validate_stat` also independently re-derives the same
PDA from the same `ts` (documented in `resolve_market.rs`'s module doc
comment), so even a contrived collision here would still need to fool
TxLINE's own program to matter. Filed anyway because "checked arithmetic
everywhere" should be true of the code itself, not conditional on a
downstream program's independent check catching what this one didn't.

**Fix:** clamp before casting, making the seed expression well-defined for
every `i64` `ts`:

```diff
-        seeds = [b"daily_scores_roots", &((ts / MS_PER_DAY) as u16).to_le_bytes()],
+        seeds = [
+            b"daily_scores_roots",
+            &((ts / MS_PER_DAY).clamp(0, u16::MAX as i64) as u16).to_le_bytes()
+        ],
```

A `require!(ts > 0, ...)` in the handler body was considered and rejected:
Anchor validates all `Accounts` constraints before the handler runs, so a
handler-body check would be unreachable dead code for exactly the input
this needs to guard against.

### F2 — Unchecked `+` on keeper-controlled `kickoff_ts` (Low/Medium)

**File:** `instructions/void_and_refund.rs`, `void_market` (now fixed at lines 111-116)

```rust
Clock::get()?.unix_timestamp > market.kickoff_ts + VOID_GRACE_PERIOD_SECS,
```

`market.kickoff_ts` is set by whichever `authority` calls
`initialize_market`, with no upper bound (only `kickoff_ts >
Clock::get()?.unix_timestamp`, `initialize_market.rs:72`). Plain `+` on an
`i64` that's attacker/bug-controlled and unbounded is exactly the pattern
`checked_*` exists for — every other arithmetic op in this program already
uses it (see the checklist row 5 pass evidence above); this one didn't.

**Why it's not just cosmetic:** the workspace's `[profile.release]
overflow-checks = true` (`anchor/Cargo.toml`) happens to turn an overflow
here into a clean panic today, so this wasn't silently exploitable *as
currently configured*. But that's an external build setting this
instruction's correctness shouldn't depend on — if it were ever changed
(e.g. someone "tidies up" the release profile without knowing why it's
there), `kickoff_ts + VOID_GRACE_PERIOD_SECS` would wrap silently instead
of panicking, and a market created with `kickoff_ts` near `i64::MAX` could
make `void_after_ts` wrap to a small or negative number — letting
`void_market` succeed **immediately**, skipping the entire one-day grace
period it exists to enforce.

**Fix:** explicit `checked_add`, independent of profile settings:

```diff
-    require!(
-        Clock::get()?.unix_timestamp > market.kickoff_ts + VOID_GRACE_PERIOD_SECS,
-        VerifibetError::TooEarlyToVoid
-    );
+    let void_after_ts = market
+        .kickoff_ts
+        .checked_add(VOID_GRACE_PERIOD_SECS)
+        .ok_or(VerifibetError::MathOverflow)?;
+    require!(
+        Clock::get()?.unix_timestamp > void_after_ts,
+        VerifibetError::TooEarlyToVoid
+    );
```

No new error variant needed — `MathOverflow` already exists and is exactly
right.

## What wasn't touched, and why

- **`kickoff_ts` still has no upper bound at `initialize_market`.** Once F2
  is fixed, an absurd `kickoff_ts` just makes that specific market's
  `void_market` call cleanly return `MathOverflow` forever — the market
  becomes permanently un-voidable (a foot-gun for whichever `authority`
  created it), not a path to attack *other* users' funds or bypass the
  grace period. Adding a bound would be reasonable future hardening but
  isn't required to close any exploit this audit found; scope-creeping it
  into this pass would be fixing a hypothetical, not a finding.
- **`resolve_market` not requiring `Locked` first** — see checklist row 6.
  Reviewed and kept as-is; it's redundant with the kickoff-time gate, not a
  gap.
- **`ScoreStat.key` ambiguity** (which stat key means "home" vs "away") is
  a known, already-documented trust boundary in `resolve_market.rs`'s own
  module doc comment, not something this audit re-discovered — TxLINE has
  no on-chain concept of home/away for a stat key, so `market.authority` is
  necessarily trusted for that one mapping. Restated here because a
  security document that omits a known trust boundary the code itself
  already documents would be misleading by omission.

## Verification

```
cd anchor
anchor build --no-idl -- --tools-version v1.52                       # default (submission) build
anchor build --no-idl -- --tools-version v1.52 --features manual-fallback
cargo test -p verifibet                                               # compute_payout unit tests + test_id
./scripts/build-idl.sh
```

All green post-fix, from a clean `rm -rf target`: both build configurations
compile with zero errors (only the project's pre-existing, unrelated
`unexpected_cfg` warnings — see `CLAUDE.md`'s toolchain notes), all 7
`cargo test -p verifibet` tests pass, and the generated IDL has all 8
instructions with matching account/arg lists.

# VERIFIBET

Solana parimutuel prediction market for the 2026 World Cup, settled against
TxODDS's on-chain data feed (TxLINE). Started as a solo entry for TxODDS's
"Prediction Markets and Settlement" hackathon; now a standalone project.
TxLINE is the primary data source for match/odds data and settlement.

## Monorepo layout

- `/` — Next.js 14.2.x App Router (this repo root). Frontend + `app/api/*`
  routes that proxy TxLINE.
- `anchor/` — Anchor 0.30.1 workspace, the on-chain program (parimutuel
  markets, bets, settlement). `programs/verifibet/src/lib.rs` holds
  `#[program]` entrypoints only; they delegate to `instructions/mod.rs`.
  `state.rs` and `errors.rs` are wired in but empty until markets/bets are
  designed.
- `keeper/` — off-chain bot: polls TxLINE, resolves markets, triggers
  settlement transactions.
- `lib/` — shared TS: `lib/config.ts` (cluster + addresses), `lib/txline/`
  (TxLINE client, server-only), `lib/solana/` (PDA derivation, program
  client), `lib/hooks/` (React hooks).
- `components/` — `ui/` (shadcn primitives), `market/`, `bet/`, `layout/`,
  `providers/` (wallet adapter, query client, etc).
- `idls/` (repo root) — generated VERIFIBET IDL JSON copied from
  `anchor/target/idl/verifibet.json`. **Not actually imported by anything**
  (confirmed by grep, 2026-07-26) — it's a courtesy/reference copy that
  `anchor/scripts/test-local.sh` keeps in sync automatically. The frontend's
  real IDL is `lib/solana/idl/verifibet.json` (+ `.ts` type helper), a
  separate copy every real import site (`lib/solana/program.ts`, every
  chain-talking `scripts/*.ts`) actually loads — also auto-synced by
  `test-local.sh` as of 2026-07-26, but wasn't before, and drifted from the
  deployed program for about a week as a result (caught and fixed during
  the v1.0.0 pass). **This is separate from `anchor/idls/`**, which holds
  *external* program IDLs (e.g. TxLINE's) for the Rust `declare_program!`
  macro — Anchor resolves that macro's IDL path relative to the program
  crate at compile time, not the repo root, so it must live under `anchor/`.
- `scripts/` — one-off/dev scripts (seed markets, airdrop, etc).
- `demo-data/` — scripted match/odds data for `DEMO_MODE=1` playback.
- `demo-assets/` — screen recordings captured at the end of each session.
- `docs/` — design notes, architecture docs.

## Cluster

Default cluster is **devnet**, selected via `NEXT_PUBLIC_CLUSTER` in
`lib/config.ts` (`CLUSTER`/`NETWORK` exports). Mainnet config exists in the
same file but is not the current deploy target (see README's "Devnet, by
design").

## Addresses (from `lib/config.ts`)

**Devnet**
- RPC: `NEXT_PUBLIC_RPC_URL` env override, else `https://api.devnet.solana.com`
  — get a free Helius devnet key on Day 1, the public RPC throttles the
  104-market sync and keeper polling.
- TxLINE API origin: `https://txline-dev.txodds.com`
- TxLINE program ID: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- TXL token mint: `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`
- USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

**Mainnet**
- RPC: `https://api.mainnet-beta.solana.com`
- TxLINE API origin: `https://txline.txodds.com`
- TxLINE program ID: `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`
- TXL token mint: `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL`

VERIFIBET's own Anchor program ID goes in `NEXT_PUBLIC_PROGRAM_ID` /
`.env.local`, not in `lib/config.ts` — it's ours, not TxLINE's.

**VERIFIBET program (devnet, deployed 2026-07-19)**
- Program ID: `CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw` —
  [explorer](https://explorer.solana.com/address/CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw?cluster=devnet)
- IDL is published on-chain (`anchor idl init`) at the same address —
  `anchor idl fetch CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw --provider.cluster devnet`
  works for anyone, no local IDL file needed.
- Upgrade authority is this machine's `~/.config/solana/id.json`
  (`ULxBcwf4vqyT2UtZzGNamBCai7vnMAbpMkBA5BeF7e6`).
- Deploy command: `anchor build --no-idl -- --tools-version v1.52 &&
  anchor deploy --provider.cluster devnet` from `anchor/` — **never** with
  `--features test-mock-txline` (that points `resolve_market`'s CPI at
  `anchor/programs/mock-txline`, a local-validator-only stand-in, instead
  of real TxLINE — see `programs/verifibet/src/lib.rs`'s `declare_program!`
  doc comment). A prior session's `anchor test` run accidentally
  deployed a `test-mock-txline` build to this exact address before this was
  caught — the deploy documented here re-deployed the correct default build
  over it.
- A `mock-txline` program also sits on devnet at
  `DAkcQvNeL4zHoMikfi6rqTf9cQ3SSbBMHM15DLM8sikR` from that same incident.
  It's inert (nothing references it once `verifibet` is built without
  `test-mock-txline`) and deliberately left alone rather than closed.

## Conventions

- **Money** is always USDC base units, 6 decimals. `bigint` in TypeScript,
  `u64` in Rust. Never floats — no `Number`/`f64` for amounts, ever.
- **TxLINE secrets are server-only.** `TXLINE_JWT`, `TXLINE_API_TOKEN` must
  never reach the client bundle. All TxLINE calls go through `app/api/*`
  routes; client code calls those routes, never TxLINE directly.
- **PDAs** are derived in exactly one place per language: `lib/solana/pda.ts`
  on the TS side, `state.rs` (Anchor `#[account(seeds = ...)]`) on the Rust
  side. Don't re-derive seeds inline elsewhere.
- **Time** is unix seconds (`i64`/`number`), not milliseconds, matching
  on-chain clock semantics.
- **Domain types** live in `lib/types.ts` — the single source of truth for
  `Fixture`, `MarketStatus`, `Outcome`, `OddsSnapshot`, `ScoreEvent`,
  `Receipt`. Don't redeclare these shapes elsewhere.
- **Outcome encoding** is `0 = home, 1 = draw, 2 = away`, matching the
  on-chain program's resolved-outcome representation exactly.
- **Odds and implied probabilities are display data, not money.**
  `OddsSnapshot.home/draw/away` and `impliedPct` are plain `number` (decimal
  odds / percentages) — the bigint/never-floats rule applies to settlement
  amounts (`betAmount`, `payout`), not to TxLINE-sourced odds data.

## Key commands

- `pnpm dev` — run the Next.js app locally.
- `pnpm tsc --noEmit` — typecheck.
- `cd anchor && anchor build --no-idl -- --tools-version v1.52` — build the
  on-chain program (`.so` + keypair). Plain `anchor build` cannot complete on
  this machine — see "Known toolchain issue" below.
- `cd anchor && ./scripts/build-idl.sh` — generate `target/idl/verifibet.json`
  + `target/types/verifibet.ts` (replaces `anchor build`'s own IDL step, see
  below). Copy the result to **both** `lib/solana/idl/` (the copy the app
  actually imports — see "Monorepo layout") and the repo-root `idls/` dir
  afterward — `anchor test`/`./scripts/test-local.sh` does both copies
  automatically, this manual command doesn't.
- `cd anchor && anchor keys sync` — sync `declare_id!`/Anchor.toml to the
  deploy keypair after a fresh build regenerates it.
- `cd anchor && anchor test` — run Anchor tests (localnet).
- `cd anchor && anchor deploy` — deploy to the configured cluster (devnet by
  default).

### Known toolchain issue: `anchor build`'s IDL step

The installed `anchor` 0.30.1 CLI binary hardcodes
`RUSTFLAGS="--cfg procmacro2_semver_exempt"` for its IDL-generation pass
(confirmed by shimming `cargo` on PATH and logging the argv/env it was
invoked with). That cfg flips `proc-macro2` into its compiler-backed
"nightly Span" mode, which corrupts the invisible-group token wrapping that
`ark-ff-macros`' `MontFp!` macro relies on to parse its string-literal args.
`ark-bn254` (via `light-poseidon`) is an unconditional dependency of
`solana-program` itself (poseidon syscall bindings) — it's in the dependency
graph of every Anchor 0.30.1 program on this machine's rustc, not just this
one — so `anchor build`'s IDL step reliably fails with `proc macro panicked
... could not parse` inside `ark-bn254`, independent of anything in this
program's own `Cargo.toml`.

`anchor/scripts/build-idl.sh` runs the same underlying `cargo test
__anchor_private_print_idl --features idl-build` invocation anchor uses
internally, but with plain `RUSTFLAGS=-A warnings` (no `semver_exempt` cfg),
and parses the resulting IDL out of the test's stdout markers itself. This
works reliably; the only loss is semver_exempt-only cross-file type-alias
resolution in the IDL, which this program doesn't use. The test's stdout
carries the IDL in separate `address`/`const`/`event`/`errors`/`program`
marker blocks (mirroring `anchor-lang-idl`'s own merge logic in
`build.rs`) — the script merges all five; an earlier version only handled
`address`/`program` and silently produced IDLs with empty `errors`/`events`
arrays even though the program had both. If a freshly generated
`target/idl/verifibet.json` is ever missing errors or events that exist in
source, check this script before assuming the Rust side is wrong.

Building with the `idl-build` feature requires `"anchor-spl/idl-build"` in
this crate's own `idl-build` feature (not just `"anchor-lang/idl-build"`)
as soon as any instruction's `Accounts` struct uses an `anchor_spl` type
(`Mint`, `TokenAccount`, ...) — otherwise those types don't implement the
`IdlBuild`/`Discriminator` traits the `#[derive(Accounts)]` macro needs
under `idl-build`, and the IDL step fails with `no function or associated
item named 'create_type' found`. `anchor-spl/idl-build`, in turn, only
compiles if the `token_2022` feature is *also* enabled: anchor-spl
0.30.1's own `idl_build.rs` unconditionally references
`crate::token_interface::{Mint,TokenAccount}`, which only exist behind
`token_2022`, regardless of whether the program actually uses Token-2022
(it doesn't — VERIFIBET's USDC is classic SPL Token throughout). So
`anchor-spl`'s feature list here is `["associated_token", "mint", "token",
"token_2022"]` even though `token_2022` itself is otherwise unused.

Separately, the on-chain `.so` build needs `--tools-version v1.52`: the
solana-cli's default bundled platform-tools (v1.41, rustc 1.75.0) ships a
`cargo` too old to parse a `Cargo.lock` v4 (the format modern `cargo`
generates by default), and pulls late-2025+ versions of transitive deps
(`indexmap`, `block-buffer` at the time of writing) that require
`edition2024`, which that old `cargo` also can't parse. v1.52's bundled
toolchain (`cargo`/`rustc` 1.89.0) handles both. `anchor/rust-toolchain.toml`
pins the *host* toolchain to the matching 1.89.0 for consistency, though it
is not honored by the IDL step for the same CLI-binary reason above (verify
with `rustc --version` from within `anchor/` if this ever needs re-diagnosing).

## TxLINE on-chain subscribe

`anchor/idls/txline.json` is TxLINE's devnet IDL, fetched via `anchor idl
fetch 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J -o anchor/idls/txline.json
--provider.cluster devnet`. It does not carry PDA seeds (no `pda` key on the
`subscribe` accounts) — those came from TxODDS's own example at
[`github.com/txodds/tx-on-chain`](https://github.com/txodds/tx-on-chain)
(`examples/devnet/common/users.ts`, `documentation/programs/devnet.mdx`,
`documentation/subscription-tiers.mdx`):

- `pricing_matrix` PDA: seeds `["pricing_matrix"]`.
- `token_treasury_v2` PDA: seeds `["token_treasury_v2"]` (named
  `tokenTreasuryPda` in the `subscribe` accounts).
- The TxL mint is **Token-2022**, not classic SPL Token — the user ATA,
  `tokenTreasuryVault` (an ATA owned by the treasury PDA), and the
  `tokenProgram` account in `subscribe` all use `TOKEN_2022_PROGRAM_ID`.
- Devnet Service Level 1 (World Cup & Int'l Friendlies) is priced at 0
  TxL/week — confirmed on-chain, not just from docs. The IDL's only devnet
  faucet instruction, `request_devnet_faucet`, mints **USDT**, not TxL; there
  is no TxL-specific faucet, and the free tier doesn't need one.
- `scripts/txline-subscribe.ts` (`pnpm txline:subscribe`) runs the full
  ensure-ATA → subscribe(serviceLevelId, weeks) flow and persists
  `{ txSig, serviceLevelId, weeks, wallet }` to `.txline-subscription.json`
  (gitignored).
- `lib/txline/http.ts` (`txlineFetch`) and `lib/txline/auth.ts`
  (`getGuestJwt`, `signActivation`, `activateToken`) implement the off-chain
  activation flow from `documentation/programs/devnet.mdx`:
  `POST /auth/guest/start` (no auth) → sign
  `${txSig}:${leagues.join(",")}:${jwt}` with the subscribing wallet → `POST
  /api/token/activate` → API token. **The wallet signature is base64, not
  base58** — confirmed against TxLINE's OpenAPI spec and its own reference
  example (`github.com/txodds/tx-on-chain`), despite base58 being the more
  common Solana convention. `/api/token/activate` returns the token as raw
  `text/plain`, not JSON. `scripts/txline-activate.ts`
  (`pnpm txline:activate`) chains this against `.txline-subscription.json`
  and upserts `TXLINE_JWT`/`TXLINE_API_TOKEN` into `.env.local` — it only
  writes on success, so a failed rerun (e.g. re-activating an already-used
  `txSig`, which 403s) never clobbers a working token. Both modules are
  server-only *by convention*, not via the `server-only` package — that
  package throws unconditionally outside Next's bundler, which would break
  these same CLI scripts.

## TxLINE data endpoints

Real paths (there is no bare `/fixtures`, `/odds`, or `/scores` — confirmed
against `https://txline-dev.txodds.com/docs/docs.yaml` and live responses),
all relative to `TXLINE_API_ORIGIN`, all requiring both auth headers:

- `GET /api/fixtures/snapshot?competitionId=&startEpochDay=` — both query
  params optional; `competitionId=72` is the World Cup. `startEpochDay`
  (unix days, i.e. `floor(unixSeconds/86400)`) defaults to the **real**
  current day UTC, not any in-story tournament date — pass it explicitly to
  see fixtures that have already kicked off relative to the real clock.
- `GET /api/odds/snapshot/{fixtureId}?asOf=` — only returns data "within
  the current 5-minute interval" (or at the historical `asOf` timestamp);
  `[]` for a fixture with no recent odds activity is a normal, real result,
  not a failure.
- `GET /api/scores/snapshot/{fixtureId}?asOf=` — returns every logged
  `Action` event for the fixture (comment, goal, substitution, lineups,
  var, game_finalised, ...); see `lib/txline/types.ts`'s `TxScore` for
  which fields are always present vs. action-dependent.

`lib/txline/types.ts` (`TxFixture`, `TxOdds`, `TxScore`) has field names
copied from real captured payloads (`scripts/txline-smoke.ts` →
`fixtures.sample.json`/`odds.sample.json`/`scores.sample.json` at repo
root), not from the OpenAPI spec — the spec disagrees with reality in two
places: the documented `Fixture` schema omits `GameState` entirely (present
on real fixtures, as a **number**), and the documented `Scores` schema is
camelCase while real score events are PascalCase like every other endpoint.

**Devnet Service Level 1 has no sampling delay** (`samplingIntervalSec: 0`
in the on-chain `pricing_matrix`, confirmed directly) — the 60-second
Service-Level-1 delay mentioned in TxODDS's own marketing copy is a
mainnet-only characteristic. Don't assume devnet data lags by 60s.

## Resolving markets via TxLINE CPI

`instructions/resolve_market.rs` (`resolve_market`, `lock_market`) CPIs into
TxLINE's `validate_stat` — resolution is impossible unless that CPI returns
`Ok(())`; there is no code path that marks a market `Resolved` without it.
Its module doc comment has the full design (sequence diagram, why
`resolve_market`'s args aren't a flat `stat_value`/`merkle_proof`, the
`GreaterThan`/`EqualTo`/`LessThan`-derived-from-`outcome` predicate
construction, and the one trust boundary that's still real: `ScoreStat.key`
is opaque, so nothing on-chain proves the keeper picked the *right* stat
keys for home/away, only that whatever keys they picked are real). Three
real `declare_program!`/`#[program]` bugs in Anchor 0.30.1 were hit and
worked around while building it, all confirmed with `cargo expand` rather
than guessed:

- **`declare_program!` chokes on the full `anchor/idls/txline.json`.**
  `anchor/idls/txline_validate.json` is a separate, trimmed copy (just
  `validate_stat` + its argument types) used only for
  `declare_program!(txline_validate)` in `lib.rs` — `anchor/idls/txline.json`
  itself is untouched, `scripts/txline-*.ts` still read the full IDL for the
  `subscribe` flow. Two independent bugs made the full IDL unusable here:
  (1) its `expose_structs` instruction has zero accounts, and
  `declare_program!` matches "composite" (nested) account groups
  *structurally* (comparing account lists) rather than by name — any other
  instruction with an empty nested accounts group collides with
  `expose_structs` and fails with "struct takes 0 lifetime arguments but 1
  lifetime argument was supplied"; (2) its `constants` include two
  `pubkey`-typed values (`TXLINE_MINT`, `USDT_MINT`) whose raw base58 string
  `declare_program!` emits as a bare Rust expression instead of wrapping in
  `pubkey!(...)`, which doesn't compile either. Neither bug is reachable
  once trimmed to just `validate_stat` (confirmed by bisecting with
  `cargo expand`).
- **`#[program]` doesn't respect per-method `#[cfg(...)]`.** Anchor 0.30.1's
  `#[program]` macro parses every `pub fn` inside the `mod` unconditionally
  when generating its own auxiliary code (client-accounts glue, dispatch),
  regardless of a `#[cfg(feature = ...)]` on an individual method — the
  method itself correctly disappears from the binary, but `#[program]`'s
  generated glue still references its now-nonexistent accounts type and
  fails to compile. `lib.rs` works around this with a `macro_rules!`
  (`verifibet_program!`) wrapping the whole `#[program] pub mod verifibet`
  body, invoked once with the extra method appended and once without —
  `macro_rules!` expansion happens as its own step before `#[program]` ever
  sees the module, so both invocations produce a fully resolved module
  either way. This is also why `resolve_market_attested`'s accounts struct
  in `resolve_market.rs` isn't nested in its own `pub mod attested { ... }`:
  `#[program]` derives its expected `__client_accounts_*` module name from
  the *first* path segment of the `Context<...>` type argument, not the
  last, so `Context<attested::ResolveMarketAttested>` looked for
  `__client_accounts_attested` instead of
  `__client_accounts_resolve_market_attested` and failed to compile.
  Flattening it to a bare, directly re-exported identifier (same pattern as
  every other instruction) sidesteps that too.
- **A fully-qualified external-program type path breaks only under
  `idl-build`.** `Program<'info, txline_validate::program::Txoracle>` (or
  even `Program<'info, crate::txline_validate::program::Txoracle>`) compiles
  fine under a normal build but fails with "use of undeclared type
  `Txoracle`" specifically when compiling with `--features idl-build` (i.e.
  inside `anchor/scripts/build-idl.sh`) — importing the bare name
  (`use crate::txline_validate::program::Txoracle;` then `Program<'info,
  Txoracle>`) avoids it.

## Session rule

Every session ends with a 30-second screen recording dropped
into `demo-assets/`.

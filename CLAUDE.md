# VERIFIBET

Solana parimutuel prediction market for the 2026 World Cup. Built solo for the
TxODDS "Prediction Markets and Settlement" hackathon (deadline 2026-07-19).
Judged on deployed build + demo video. TxLINE (TxODDS's Solana data feed) is
the primary data source for match/odds data and settlement.

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
  `anchor/target/idl/verifibet.json`, consumed by `lib/solana/` in the
  frontend. **This is separate from `anchor/idls/`**, which holds *external*
  program IDLs (e.g. TxLINE's) for the Rust `declare_program!` macro —
  Anchor resolves that macro's IDL path relative to the program crate at
  compile time, not the repo root, so it must live under `anchor/`.
- `scripts/` — one-off/dev scripts (seed markets, airdrop, etc).
- `demo-data/` — scripted match/odds data for `DEMO_MODE=1` playback.
- `demo-assets/` — screen recordings captured at the end of each session.
- `docs/` — design notes, architecture docs.

## Cluster

Default cluster is **devnet**, selected via `NEXT_PUBLIC_CLUSTER` in
`lib/config.ts` (`CLUSTER`/`NETWORK` exports). Mainnet config exists in the
same file but is not the target for the hackathon deadline.

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

VERIFIBET's own Anchor program ID (once deployed) goes in
`NEXT_PUBLIC_PROGRAM_ID` / `.env.local`, not in `lib/config.ts` — it's ours,
not TxLINE's.

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
  below). Copy the result to the repo-root `idls/` dir afterward.
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
resolution in the IDL, which this program doesn't use.

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

## Session rule

Every session ends with a commit and a 30-second screen recording dropped
into `demo-assets/`.

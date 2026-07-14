# VERIFIBET

Solana parimutuel prediction market for the 2026 World Cup. Built solo for the
TxODDS "Prediction Markets and Settlement" hackathon (deadline 2026-07-19).
Judged on deployed build + demo video. TxLINE (TxODDS's Solana data feed) is
the primary data source for match/odds data and settlement.

## Monorepo layout

- `/` — Next.js 14.2.x App Router (this repo root). Frontend + `app/api/*`
  routes that proxy TxLINE.
- `anchor/` — Anchor 0.30.1 workspace, the on-chain program (parimutuel
  markets, bets, settlement). Not yet scaffolded — added in step 1.5.
- `keeper/` — off-chain bot: polls TxLINE, resolves markets, triggers
  settlement transactions.
- `lib/` — shared TS: `lib/config.ts` (cluster + addresses), `lib/txline/`
  (TxLINE client, server-only), `lib/solana/` (PDA derivation, program
  client), `lib/hooks/` (React hooks).
- `components/` — `ui/` (shadcn primitives), `market/`, `bet/`, `layout/`,
  `providers/` (wallet adapter, query client, etc).
- `idls/` — generated Anchor IDL JSON, consumed by `lib/solana/`.
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

## Key commands

- `pnpm dev` — run the Next.js app locally.
- `pnpm tsc --noEmit` — typecheck.
- `cd anchor && anchor build` — build the on-chain program.
- `cd anchor && anchor test` — run Anchor tests (localnet).
- `cd anchor && anchor deploy` — deploy to the configured cluster (devnet by
  default).

## Session rule

Every session ends with a commit and a 30-second screen recording dropped
into `demo-assets/`.

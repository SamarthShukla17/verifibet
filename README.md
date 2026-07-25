This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Deployed program (devnet)

- Program ID: `CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw`
- Explorer: https://explorer.solana.com/address/CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw?cluster=devnet
- IDL is published on-chain (`anchor idl init`) — introspectable directly
  from the program address, no local IDL file required.

## Market rules

- **Group stage** markets are a plain 1X2: home / draw / away.
- **Knockout stage** markets (Round of 32 through the Final, including the
  3rd-place playoff) are **two-outcome, "who advances"** — home / away
  only, no Draw. A knockout match always produces a winner: if the score
  is level after 90 minutes, extra time and then a penalty shootout decide
  who advances, so a draw is never a real settlement outcome for one of
  these markets. This is enforced in exactly one place —
  `lib/txline/normalize.ts#deriveOutcome` — and the frontend mirrors it by
  never offering a Draw tile on a knockout fixture's market
  (`lib/market.ts#isKnockoutStage`). See `SECURITY.md`'s "Off-chain
  invariant: knockout markets never resolve to a draw" for the full
  reasoning and the golden test vector (Paraguay 4-3 Germany on penalties,
  after a 1-1 FT+ET draw) that pins it down.

## Plan notes

- Devnet demo uses a 6dp mock USDC mint (`NEXT_PUBLIC_USDC_MINT` in
  `.env.local`), not Circle's real devnet USDC — Circle's faucet
  (faucet.circle.com) is reCAPTCHA-gated (can't be scripted) and caps
  requests at 20 USDC per network every 2 hours, nowhere near enough to fund
  betting tests. The program pins whatever mint each market is initialized
  with, so this is a drop-in swap and nothing else changes.

## Reproducing the demo environment

Judges (or anyone) can populate a live, walkable demo of the deployed
program with one command — real markets, real varied bets, real settled
receipts, no manual setup:

```bash
cp .env.local.example .env.local   # fill in KEEPER_SECRET_KEY, TXLINE_*, etc.
pnpm install
pnpm seed:demo
```

This is `scripts/seed-demo.ts`, idempotent (safe to re-run — it skips
whatever already exists rather than duplicating it):

1. **Creates five on-chain markets** in the "demo range" (`+9,000,000`
   fixture ids — see `lib/txline/demoScenarios.ts`), one per demo
   scenario (`pens`, `qf-thriller`, `underdog`, `late-drama`,
   `final-preview` — see `demo-data/scenarios/`), so the on-chain betting
   flow and the `DEMO_MODE=1` replay pill narrate the exact same five
   matches.
2. **Places ~20 varied bets** on them from three deterministic, publicly
   re-derivable devnet wallets (`demo-alice`/`demo-bob`/`demo-carol` — see
   `scripts/seed-bets.ts`'s own doc comment for the exact seed), so
   `/leaderboard` has real, distinguishable activity instead of looking
   empty.
3. **Resolves two real fixtures** (not demo-range ones — `resolve_market`'s
   CPI only ever succeeds against TxLINE's genuine on-chain data) through
   the exact same backfill path `pnpm keeper:resolve --fixture <id>` uses,
   so `/portfolio` and `/receipts/<fixtureId>` have real, Merkle-proof-
   verified settled content, not just open markets.
4. **Leaves exactly one unclaimed winning bet** on the presenter/dev
   wallet, discovered and enforced by directly scanning that wallet's
   real on-chain `Bet` accounts (`scripts/demoRig.ts`) — not a hardcoded
   assumption about what should be there.

Between recorded takes, `pnpm reset:demo` re-arms that one claimable win
if a take actually claimed it — fabricating a fresh one honestly (a real,
historical, already-decided World Cup fixture, bet on the side that
already won, resolved through the same real backfill path) rather than
faking an outcome.

**Two known, deliberate gaps** — both confirmed live, not theoretical,
documented in `scripts/seed-demo.ts`'s own doc comment:

- `pens`'s real fixture (Germany v Paraguay) is **permanently
  unresolvable** through `resolve_market`'s real CPI — it was decided on
  penalties, and the CPI only ever proves an FT+ET goal difference, with
  no on-chain representation of a shootout at all (see
  `resolve_market.rs`'s module doc comment). Submitting the real winner
  would fail the proof's own predicate; `resolveFixtureInner` correctly
  refuses rather than resolving dishonestly. Its market stays `Open`.
- `late-drama`'s real fixture (Argentina v Cape Verde) hits a
  reproducible `TimestampMismatch` from TxLINE's own `validate_stat` CPI
  — looks like a TxLINE-side devnet data issue outside this program's
  control (an otherwise-identical resolution against a different fixture
  succeeds cleanly). Its market also stays `Open`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

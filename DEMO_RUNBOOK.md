# Demo runbook

The exact, rehearsed click path for recording a live VERIFIBET demo take:
open a pre-kickoff demo scenario → place a real bet → watch the match play
out → the keeper auto-locks and auto-resolves it with no human in the
loop → claim → verified receipt. Every step below was actually run
end-to-end against devnet while writing this, not assumed.

## One-time setup (per machine)

```bash
pnpm install
cp .env.local.example .env.local   # fill in KEEPER_SECRET_KEY, TXLINE_*, NEXT_PUBLIC_*
pnpm seed:demo                     # populates leaderboard/portfolio/receipts content
```

`pnpm seed:demo`'s own doc comment (`scripts/seed-demo.ts`) covers what it
does — this runbook is specifically about the *live, on-camera* path,
which needs one more piece `seed:demo` doesn't set up: a demo-range
market that's still genuinely pre-kickoff (see "Reset command" below).

## Two processes, both required

```bash
DEMO_MODE=1 pnpm dev     # the app — DEMO_MODE scoped to THIS process only, see below
pnpm keeper              # separate terminal, plain env (no DEMO_MODE)
```

**`DEMO_MODE=1` must never end up in `.env.local` itself.** Both `pnpm
dev` and `pnpm keeper` load the same `.env.local` — if `DEMO_MODE=1` were
set there, the keeper would *also* spin up its own independent replay of
every demo scenario (`lib/txline/stream.ts`'s `TxlineStreamManager`
constructor checks `isDemoModeEnabled()` unconditionally), completely
decoupled from whatever the browser is actually showing. The keeper
learns about demo fixtures a different way — see below — so it never
needs `DEMO_MODE` itself. Pass it inline to `pnpm dev` only, exactly as
shown above.

Confirm both are actually up before doing anything else:

```bash
curl -s http://localhost:3000/api/demo | python3 -c "import json,sys;print(json.load(sys.stdin)['active'])"   # true
curl -s http://localhost:8787/healthz                                                                          # keeper health
```

If you restart either process, **restart the other too** if you also
just ran the reset command below — both cache the scenario files
(`lib/txline/demoScenarios.ts#loadDemoScenarios()`) at module scope for
the life of the process.

## Reset command — get a fresh, pre-kickoff market

`initialize_market` is a genuine one-shot per fixture id — there is no
"update kickoff" instruction, so once a demo-range market's kickoff
passes, `place_bet` is permanently closed on that exact on-chain account,
forever. Confirmed live, not theoretical: every demo-range market
`seed:demo` creates has only a ~20 minute window before this happens.

```bash
pnpm tsx scripts/rearm-scenario.ts <scenario> [kickoffBufferSeconds]
# e.g. pnpm tsx scripts/rearm-scenario.ts qf-thriller 90
```

This gives the named scenario a **fresh fixture id** (its `.rest.json`/
`.ndjson` are rewritten in place, the old id is simply abandoned — same
"left inert" treatment as the `mock-txline` incident CLAUDE.md already
documents), initializes a brand-new `Market` with `kickoff_ts = now +
kickoffBufferSeconds` (default 90s), and prints the fixture id to open.

**After running it, restart `pnpm dev` and `pnpm keeper` both** (scenario
file cache — see above), then wait ~15-20s before navigating (Next's own
`/api/fixtures` fetch cache on the match page is `revalidate: 30`; a page
load that lands inside that window can show a false 404 for a
brand-new fixture id).

Run this once per scenario you intend to record, right before that
take — not hours ahead of time. 90s of kickoff buffer is enough for the
UI clicks below (thanks to the paused-by-default fix); it does **not**
need to be long, and a long buffer just means more idle real time before
"Kickoff" fires.

## The click path (per scenario)

Every demo scenario follows the identical path once rearmed. Total
real time, clicks only (excludes wallet-popup approval time, which
depends on the human doing it): **under 90 seconds**.

1. **Open the fresh match page** — `/matches/<newFixtureId>` (printed by
   the reset command). Confirm: `Open` badge, `vs` header (not live),
   pill shows `❚❚` (paused) — "reconstructed"/"synthetic" source badge,
   never "recorded" (see `demo seed`'s own honesty work).
2. **Connect wallet** (if not already) — top-right button. Use the
   presenter/dev wallet, the same one `KEEPER_SECRET_KEY` resolves to
   (`market.authority` — the keeper needs to be the same identity that
   created the market to lock/resolve it).
3. **Place a 25 USDC bet** — click an outcome tile, amount defaults to
   $25 (or click the `$25` quick-chip), **Place Bet**, hold the
   **Hold to confirm** button (~700ms), approve in the wallet popup.
   Confirm: bet slip clears, the position appears in Activity.
4. **Click the pill → Kickoff** (or **Play**) — un-pauses the replay
   (`jumpDemoTo` always resumes playback). Within ~8s (the keeper's
   demo-poll interval, `DEMO_POLL_MS` in `keeper/index.ts`) the header
   flips to **LIVE**, and the keeper auto-**locks** the market
   (`lock_market` — no TxLINE dependency, works identically for every
   fixture id). Confirm via the market status badge, or
   `pnpm keeper`'s own log line: `lockMarket locked`.
5. **Click the pill → Goal** — odds jump immediately (replay chapter
   jumps are near-instant, not tied to real match duration) with the
   red/green delta flash on the tiles that changed.
6. **Click the pill → Full-time** — score locks in, badge flips to
   **Resolved** shortly after (see next step) — Full-time also plays
   through whatever real captured events sit between Goal and FT
   (typically a few seconds at 60×).
7. **Wait — the keeper auto-resolves within ~60s of Full-time**, no
   further clicks. It's polling the app's own `/api/fixtures` every 8s
   (`keeper/demoResolver.ts#pollLiveDemoFixtureStatuses`) for this exact
   scenario's fixture id turning `FINISHED`, then submits
   `resolve_market_attested` with an outcome/commitment derived from the
   scenario's own real captured/reconstructed final score (see that
   module's own doc comment — never a fabricated outcome). Confirm via
   `pnpm keeper`'s log: `resolveDemoMarket resolved`, or the market
   badge flipping to **Resolved**.
8. **Portfolio → Claim** — `/portfolio`, the position now shows **Won**
   with a real **Claim** button (wired this session — see "What changed"
   below), hold/click to confirm, approve in the wallet popup. Confirm:
   row flips to **Claimed**.
9. **Receipt** — `/receipts/<fixtureId>`. Confirm: honest **"Demo
   scenario — resolved by authority attestation, not TxLINE"** banner
   (gold, not the real-market green "Settled by TxODDS TxLINE" one —
   demo-range markets never show the latter, see `demo seed`'s own
   receipts work), real final score, real resolve tx.
10. **Verify animation** — click **Verify in your browser** on the
    receipt. For a demo-range receipt this verifies the local commitment
    (leaf === root, no Merkle chain — the panel labels this "Local
    commitment (on-chain)", not "Root (on-chain)") — the ~800ms staged
    reveal still plays, honestly narrated as a commitment check, not a
    TxLINE proof.

## Timings, measured

| Step | Real time |
|---|---|
| Kickoff buffer (bet → on-chain kickoff) | 90s (configurable) |
| Kickoff click → keeper locks | ≤8s (demo-poll interval) |
| Goal/Full-time chapter jumps | near-instant |
| Full-time → keeper resolves | ≤60s (typically ~8-15s) |
| Claim → Claimed | one confirmed tx (~2-5s on a healthy RPC) |

Devnet's public RPC (`https://api.devnet.solana.com`, the default absent
a `NEXT_PUBLIC_RPC_URL` override) is genuinely rate-limited and
occasionally times out — confirmed repeatedly this session, on both
`anchor deploy` and live `place_bet` sends. If a step visibly hangs
(">15s with no toast change) or shows "Something went wrong sending your
transaction", it's almost always this, not a logic bug — retry the same
click. A Helius devnet key removes this risk entirely (see CLAUDE.md).

## What changed this session (Phase 7 exit)

Real bugs found by actually rehearsing, not by reading the code:

- **Replay used to auto-play at 60× from server boot**, completely
  decoupled from a fresh market's own `kickoff_ts` — by the time a
  couple of minutes of real setup passed, the replay had already raced
  through Full-time and the keeper had already tried to lock/resolve the
  market before a single bet was placed. Fixed:
  `lib/txline/demoControl.ts` now starts every scenario **paused**;
  only an explicit Play or chapter-jump click advances it.
- **The bet slip checked the wrong USDC mint's balance** — a hardcoded
  `CIRCLE_DEVNET_USDC_MINT` (capped at 20 USDC by Circle's own faucet)
  instead of the specific market's own `usdc_mint`, so a wallet holding
  thousands of the *correct* mock USDC still showed "Not enough USDC" on
  a 25 USDC bet. Fixed: `useBalances`/`usePlaceBet` now read the
  connected market's own mint.
- **The keeper had no way to resolve a demo-range market at all** —
  `resolve_market`'s real CPI only ever validates against TxLINE's
  genuine data, which has never heard of a `+9,000,000`-offset fixture
  id. Fixed: the program was redeployed with `--features manual-fallback`
  (enabling `resolve_market_attested`, designed for exactly this — see
  its own doc comment in `resolve_market.rs`, and the required disclosure
  in README.md's "Reproducing the demo environment") and the keeper
  gained a new ~8s poll loop (`keeper/demoResolver.ts`) watching the
  app's own live fixture status over HTTP.
- **Receipts for demo-range markets would have silently claimed
  "Settled by TxODDS TxLINE — outcome verified on-chain"**, exactly the
  same as a real market — dishonest, since no CPI ever verified them.
  Fixed: `lib/receipts.ts`/`ProofPanel.tsx` now label every demo-range
  receipt honestly as authority-attested.
- **The CLAIM button (`won` positions) and "Claim All" were both
  placeholder toasts** ("Claiming lands in Phase 6") — the video path
  needs a real claim to record. Fixed: `lib/hooks/useClaimWinnings.ts`
  (new, mirrors the already-real `useClaimRefund.ts`), wired into
  `PositionRow.tsx` and `app/portfolio/page.tsx`'s "Claim All".

## Per-scenario notes

All five scenarios (`pens`, `qf-thriller`, `underdog`, `late-drama`,
`final-preview`) follow the identical path above once rearmed, with one
exception:

- **`final-preview` never resolves, on purpose** — it's a genuine
  pre-match-only scenario (no `game_finalised` event at all in its own
  data, see `scripts/build-demo-scenario.ts`'s doc comment on it), so it
  has no Goal/Full-time chapters and `keeper/demoResolver.ts`'s outcome
  derivation would correctly throw if ever asked to resolve it. Don't
  use it for this recording path — pick one of the other four.
- **`pens` resolves cleanly through `resolve_market_attested` despite
  being a penalty shootout** — unlike its *real* fixture id (permanently
  stuck `Open`, see `scripts/seed-demo.ts`'s own doc comment on why the
  real CPI can't represent a shootout at all), the demo-range attested
  path derives its outcome the same way `deriveOutcome` always has,
  penalties included, with no CPI predicate to fail against.

## Recording

`mcp__claude-in-chrome__gif_creator` (or any screen recorder) — start
right before step 1, stop right after step 10. Target: **≤ 2 minutes**
end to end. Export to `demo-assets/`.

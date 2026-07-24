/**
 * Seeds 3 throwaway, clearly-named devnet wallets — `demo-alice`,
 * `demo-bob`, `demo-carol` — with SOL + this project's mock USDC, then
 * has each place a few varied, real `place_bet` transactions, so
 * `/leaderboard` has more than one wallet's worth of real data to render
 * instead of looking empty on a fresh checkout.
 *
 * **Honesty, not disguise**: `demo-alice`/`demo-bob`/`demo-carol` only
 * ever exist as this script's own local names and console labels —
 * Solana has no on-chain "display name" concept, so there's nothing to
 * fake. Each wallet is *deterministically* derived from a fixed, literal
 * seed string below (`DEMO_SEED_PREFIX`), not randomly generated and
 * stashed in a gitignored file — anyone reading this file can re-derive
 * the exact same three addresses themselves and see there's nothing
 * hidden about where they came from. Re-running this script is
 * idempotent in the sense that it always targets the same three
 * wallets, though `place_bet` itself is not idempotent (a second run
 * against the same markets adds a second round of bets on top, same as
 * a real user re-betting).
 *
 * The dev wallet is both this mock mint's authority and every market's
 * `authority` (see `scripts/sync-markets.ts`), so funding and market
 * creation both come from it directly — no faucet, no manual setup.
 *
 * Every actual bet is placed through the exact same client path the UI
 * uses (`lib/solana/program.ts#getProgram`/`placeBet`,
 * `lib/solana/sendTx.ts#sendAndConfirm`), the same pattern
 * `scripts/bet-e2e.ts` already established — just driven by 3 keypairs
 * instead of 1, each wrapped in the same small `WalletContextState`
 * adapter.
 *
 * Usage: pnpm tsx scripts/seed-bets.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import { sha256 } from "@noble/hashes/sha2.js";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import { deriveMarket, PROGRAM_ID } from "@/lib/solana/pda";
import { getProgram, getReadOnlyProgram, MARKET_ACCOUNT_IDL_NAME, placeBet } from "@/lib/solana/program";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import { fetchTournamentFixtures, syncMarkets } from "@/scripts/sync-markets";
import { explorerAddressUrl } from "@/lib/explorer";
import { formatUsdc } from "@/lib/format";
import { isKnockoutStage } from "@/lib/market";
import { toFixture } from "@/lib/txline/normalize";
import type { TxFixture } from "@/lib/txline/types";
import type { Outcome } from "@/lib/types";

const DEMO_NAMES = ["demo-alice", "demo-bob", "demo-carol"] as const;
type DemoName = (typeof DEMO_NAMES)[number];

/** Literal, auditable — see module doc comment. Anyone can run
 * `sha256("verifibet-demo-wallet:demo-alice")` -> `Keypair.fromSeed(...)`
 * themselves and get the exact same address this script derives. */
const DEMO_SEED_PREFIX = "verifibet-demo-wallet:";

function deriveDemoKeypair(name: DemoName): Keypair {
  return Keypair.fromSeed(sha256(new TextEncoder().encode(DEMO_SEED_PREFIX + name)));
}

/** Just enough SOL for a handful of `place_bet` transactions' fees —
 * same headroom philosophy as `scripts/bet-e2e.ts`'s USDC mint, not a
 * precisely-computed minimum. */
const SOL_FUNDING_LAMPORTS = 0.05 * anchor.web3.LAMPORTS_PER_SOL;

const MARKETS_TO_SEED = 2;
/** Staggered, not identical — two markets with the exact same kickoff
 * would still work, but distinct times read more like two real,
 * independent fixtures in the UI. */
const KICKOFF_OFFSETS_SECONDS = [900, 1500];

interface DemoBetPlan {
  wallet: DemoName;
  /** Index into the freshly-synced fixtures array below. */
  fixtureIndex: 0 | 1;
  outcome: Outcome;
  amountUsdc: number;
}

/**
 * Deliberately varied — different wallets, different fixtures, different
 * outcomes, different (including one fractional) amounts — so `/leaderboard`
 * has real, distinguishable Volume numbers to sort by instead of three
 * identical rows. `outcome` only ever 0/2 (never 1, "Draw"): both fixtures
 * picked below are real knockout-stage matches, and the UI itself never
 * offers a Draw tile for those (`lib/market.ts#isKnockoutStage`) — this
 * mirrors what a real bettor could actually click, even though `place_bet`
 * itself doesn't enforce that rule on-chain.
 */
const DEMO_BETS: DemoBetPlan[] = [
  { wallet: "demo-alice", fixtureIndex: 0, outcome: 0, amountUsdc: 12 },
  { wallet: "demo-alice", fixtureIndex: 1, outcome: 2, amountUsdc: 4 },
  { wallet: "demo-bob", fixtureIndex: 0, outcome: 2, amountUsdc: 7.25 },
  { wallet: "demo-bob", fixtureIndex: 1, outcome: 0, amountUsdc: 9 },
  { wallet: "demo-carol", fixtureIndex: 0, outcome: 0, amountUsdc: 3.5 },
  { wallet: "demo-carol", fixtureIndex: 1, outcome: 2, amountUsdc: 20 },
];

function loadDevKeypair(): Keypair {
  const raw = JSON.parse(readFileSync(join(homedir(), ".config", "solana", "id.json"), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Same adapter shape `scripts/bet-e2e.ts` uses — a real `Keypair`
 * standing in for a browser wallet extension, satisfying just enough of
 * `WalletContextState` for `getProgram`/`sendAndConfirm` to accept it. */
function keypairWallet(keypair: Keypair): WalletContextState {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
      if (tx instanceof Transaction) tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      for (const tx of txs) if (tx instanceof Transaction) tx.partialSign(keypair);
      return txs;
    },
    sendTransaction: async (tx: Transaction, connection: Connection) => {
      tx.partialSign(keypair);
      return connection.sendRawTransaction(tx.serialize());
    },
  } as unknown as WalletContextState;
}

/** Fixtures TxLINE knows about that don't already have a `Market` PDA on
 * devnet — dynamic, not a hardcoded fixture-id list, so this keeps
 * working across sessions regardless of which fixtures earlier sessions
 * already used (see NOTES.md for the running list). Prefers knockout-
 * stage fixtures (a nicer demo — real stakes, no Draw outcome to
 * complicate `DEMO_BETS`) but falls back to anything fresh if it can't
 * find enough. */
async function pickFreshFixtures(count: number): Promise<TxFixture[]> {
  const readOnly = getReadOnlyProgram();
  const marketClient = (
    readOnly.account as Record<string, { fetchNullable(addr: PublicKey): Promise<unknown | null> }>
  )[MARKET_ACCOUNT_IDL_NAME];

  const fixtures = await fetchTournamentFixtures();

  async function isFresh(fixture: TxFixture): Promise<boolean> {
    const [market] = deriveMarket(BigInt(fixture.FixtureId));
    return (await marketClient.fetchNullable(market)) === null;
  }

  // TxFixture (TxLINE's raw shape) has no `stage` field of its own —
  // `toFixture` derives it from `FixtureGroupId` (see
  // lib/txline/normalize.ts) the same way the rest of the app does, so
  // this doesn't need its own second stage-classification table.
  const fresh: TxFixture[] = [];
  for (const fixture of fixtures.filter((f) => isKnockoutStage(toFixture(f).stage))) {
    if (fresh.length >= count) break;
    if (await isFresh(fixture)) fresh.push(fixture);
  }
  for (const fixture of fixtures) {
    if (fresh.length >= count) break;
    if (fresh.some((f) => f.FixtureId === fixture.FixtureId)) continue;
    if (await isFresh(fixture)) fresh.push(fixture);
  }

  if (fresh.length < count) {
    throw new Error(`Only found ${fresh.length} fixture(s) without an existing Market — needed ${count}.`);
  }
  return fresh;
}

/**
 * `CONFIG.devnet.usdcMint`/`rpcUrl` (`lib/config.ts`) can't be trusted in
 * this script: it statically imports `lib/solana/program.ts` (needed for
 * `getProgram`/`getReadOnlyProgram`/`placeBet`), which itself statically
 * imports `lib/config.ts` — and per NOTES.md's own documented finding
 * (originally hit in `scripts/devnet-e2e.ts`), every static `import` in
 * a module is hoisted and evaluated before that module's own top-level
 * code runs, *regardless of source order*, so `lib/config.ts` evaluates
 * — freezing `usdcMint` from whatever `process.env.NEXT_PUBLIC_USDC_MINT`
 * was at that moment, i.e. still `undefined` — before this file's own
 * `process.loadEnvFile()` call ever runs. Unlike `devnet-e2e.ts`'s fix
 * (making its *own* `import` of `lib/config` dynamic), that trick alone
 * doesn't help here: the module registry already cached the frozen value
 * via the transitive static chain through `lib/solana/program.ts`, so
 * re-importing `lib/config` later just returns that same frozen object.
 * The only real fix is to never route these two values through
 * `lib/config.ts` at all — read `process.env` directly, inside `main()`,
 * which genuinely does run after `process.loadEnvFile()` (only `main()`
 * at the very bottom of this file runs after that top-level call) — with
 * the identical fallback defaults `lib/config.ts` itself uses, so this
 * stays in sync with it by inspection.
 *
 * Confirmed the hard way, not theoretically: a run of this exact script
 * before this fix existed silently initialized two Markets against the
 * *wrong* mint (Circle's real, faucet-gated devnet USDC — this script
 * has no mint authority over that one). Since `Market.usdc_mint` can't
 * change after `initialize_market`, those two fixtures' markets are now
 * permanently unusable for this demo and were abandoned — see NOTES.md.
 */
function resolveDevnetRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
}

function resolveUsdcMint(): PublicKey {
  return new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
}

async function main() {
  const connection = new Connection(resolveDevnetRpcUrl(), "confirmed");
  const devWallet = loadDevKeypair();
  const usdcMint = resolveUsdcMint();

  console.log(`dev wallet:  ${devWallet.publicKey.toBase58()}`);
  console.log(`program:     ${PROGRAM_ID.toBase58()}  (${explorerAddressUrl(PROGRAM_ID.toBase58())})`);
  console.log(`mock USDC:   ${usdcMint.toBase58()}\n`);

  console.log(`--- syncing ${MARKETS_TO_SEED} fresh markets ---`);
  const fixtures = await pickFreshFixtures(MARKETS_TO_SEED);
  const now = Math.floor(Date.now() / 1000);

  const devProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(devWallet), {
    commitment: "confirmed",
  });
  const verifibetIdl = (await import("@/lib/solana/idl/verifibet.json")).default;
  const devProgram = new anchor.Program(
    { ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() },
    devProvider,
  );

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const kickoffOverrideTs = now + KICKOFF_OFFSETS_SECONDS[i];
    const [result] = await syncMarkets(connection, devProgram, devWallet, {
      fixtureId: fixture.FixtureId,
      kickoffOverrideTs,
      usdcMint, // explicit — see resolveUsdcMint's doc comment above
    });
    const [market] = deriveMarket(BigInt(fixture.FixtureId));
    console.log(
      `[${i}] fixture ${fixture.FixtureId} (${fixture.Participant1} vs ${fixture.Participant2}, ${toFixture(fixture).stage}) ` +
        `-> ${result.outcome} market ${market.toBase58()}  (${explorerAddressUrl(market.toBase58())})`,
    );
  }

  console.log(`\n--- funding demo wallets ---`);
  const totalNeededByWallet = new Map<DemoName, number>();
  for (const bet of DEMO_BETS) {
    totalNeededByWallet.set(bet.wallet, (totalNeededByWallet.get(bet.wallet) ?? 0) + bet.amountUsdc);
  }

  const demoKeypairs = new Map<DemoName, Keypair>();
  for (const name of DEMO_NAMES) {
    const keypair = deriveDemoKeypair(name);
    demoKeypairs.set(name, keypair);

    const solTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: devWallet.publicKey,
        toPubkey: keypair.publicKey,
        lamports: SOL_FUNDING_LAMPORTS,
      }),
    );
    await anchor.web3.sendAndConfirmTransaction(connection, solTx, [devWallet], { commitment: "confirmed" });

    const ata = await getOrCreateAssociatedTokenAccount(connection, devWallet, usdcMint, keypair.publicKey);
    const neededUsdc = totalNeededByWallet.get(name) ?? 0;
    // Headroom for repeated runs, same as bet-e2e.ts's own mint call.
    const mintAmount = Math.round(neededUsdc * 1_000_000 * 2);
    await mintTo(connection, devWallet, usdcMint, ata.address, devWallet, mintAmount);

    console.log(
      `${name}: ${keypair.publicKey.toBase58()}  ` +
        `(${explorerAddressUrl(keypair.publicKey.toBase58())}) — ` +
        `funded ${SOL_FUNDING_LAMPORTS / anchor.web3.LAMPORTS_PER_SOL} SOL + ${formatUsdc(BigInt(mintAmount))} USDC`,
    );
  }

  console.log(`\n--- placing ${DEMO_BETS.length} varied bets ---`);
  for (const plan of DEMO_BETS) {
    const keypair = demoKeypairs.get(plan.wallet)!;
    const wallet = keypairWallet(keypair);
    const fixture = fixtures[plan.fixtureIndex];
    const amountBaseUnits = BigInt(Math.round(plan.amountUsdc * 1_000_000));

    const program = getProgram(connection, wallet);
    const tx = await placeBet(program, {
      fixtureId: BigInt(fixture.FixtureId),
      outcome: plan.outcome,
      amountBaseUnits,
    });
    const signature = await sendAndConfirm(connection, wallet, tx, {
      label: `${plan.wallet} betting ${plan.amountUsdc} USDC`,
    });

    const pick = plan.outcome === 0 ? fixture.Participant1 : fixture.Participant2;
    console.log(
      `${plan.wallet.padEnd(11)} ${String(plan.amountUsdc).padStart(6)} USDC on ${pick.padEnd(16)} ` +
        `(fixture ${fixture.FixtureId}) — ${signature}`,
    );
  }

  console.log(`\n✅ Seeded ${DEMO_NAMES.length} demo wallets across ${fixtures.length} markets — /leaderboard should now be populated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

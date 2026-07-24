/**
 * Phase-2 exit proof: a real on-chain bet on a real World Cup fixture,
 * against the actually-deployed devnet program (CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw).
 *
 * Picks the soonest still-upcoming CompetitionId=72 fixture from TxLINE's
 * live devnet API (not the stale local fixtures.sample.json — see below),
 * initializes a Market for it if one doesn't already exist, places a 5 USDC
 * bet from the dev wallet, then reads back Market + Bet + vault state.
 *
 * Substitution note: the task asked for "a real upcoming quarterfinal".
 * Querying TxLINE live (no `startEpochDay` override, i.e. real "today")
 * returns exactly one CompetitionId=72 fixture right now — the Final
 * (Spain vs Argentina). The quarterfinal round (FixtureGroupId 10115675:
 * France-Morocco, Norway-England, Spain-Belgium, Argentina-Switzerland) has
 * already kicked off in this simulated tournament's timeline, and
 * `initialize_market` hard-requires `kickoff_ts > now` on-chain — there is
 * no real quarterfinal fixture left to initialize a market against. Using
 * the real, genuinely-upcoming Final instead of a stale/past quarterfinal
 * keeps every on-chain fact (fixture id, teams, kickoff time) real; only
 * the tournament round differs from what was asked. Confirmed by hand
 * before writing this script:
 *   GET /api/fixtures/snapshot?competitionId=72
 *   -> [{"FixtureId":18257739,"Participant1":"Spain","Participant2":"Argentina",
 *        "StartTime":1784487600000,"GameState":1}]
 *
 * Usage: pnpm tsx scripts/devnet-e2e.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { deriveBet, deriveMarket } from "@/lib/solana/pda";
import { formatUsdc } from "@/lib/format";
import type { TxFixture } from "@/lib/txline/types";
import verifibetIdl from "@/lib/solana/idl/verifibet.json";

// Dynamic, not static: static `import` declarations are hoisted above every
// other top-level statement (including the `process.loadEnvFile` call
// above) regardless of source order, so a static import of `@/lib/config`
// here would freeze its env-derived fields (`usdcMint`) using whatever
// `process.env` looked like *before* `.env.local` was loaded — confirmed by
// reproducing it in isolation, not guessed. `txlineFetch` reads
// `process.env` at call time inside its own function body instead of at
// module-eval time, so it doesn't need this treatment.
async function loadConfig() {
  return import("@/lib/config");
}

const KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");
const WORLD_CUP_COMPETITION_ID = 72;
const BET_AMOUNT_USDC = 5_000_000; // 5 USDC, 6dp base units
const BET_OUTCOME = 0; // home (Participant1) — arbitrary pick for this proof

// verifibet's own on-chain account names are the fully-qualified Rust paths
// this build's IDL pipeline emits ("verifibet::state::Market", not "Market")
// — Anchor's client-side camelCase pass lowercases each `::`-separated
// segment individually ("verifibet::state::market") without touching the
// `::`, and that runtime key doesn't match the un-camelCased literal the
// generated TS type carries at compile time. Same quirk hit and documented
// in anchor/tests/verifibet.ts; worked around there the same way, via `any`.
const MARKET_ACCOUNT = "verifibet::state::market";
const BET_ACCOUNT = "verifibet::state::bet";

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function fetchUpcomingWorldCupFixture(): Promise<TxFixture> {
  const { txlineFetch } = await import("@/lib/txline/http");
  const res = await txlineFetch(
    `/api/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}`,
  );
  const fixtures = (await res.json()) as TxFixture[];
  const now = Date.now();
  const upcoming = fixtures
    .filter((f) => f.StartTime > now)
    .sort((a, b) => a.StartTime - b.StartTime);

  if (upcoming.length === 0) {
    throw new Error(
      "No upcoming CompetitionId=72 fixtures returned by TxLINE right now.",
    );
  }
  return upcoming[0];
}

async function main() {
  const { CONFIG } = await loadConfig();
  const wallet = loadKeypair(KEYPAIR_PATH);
  const connection = new anchor.web3.Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" },
  );
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID ??
      "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
  );
  const program = new anchor.Program(
    { ...(verifibetIdl as anchor.Idl), address: programId.toBase58() },
    provider,
  );
  const usdcMint = new PublicKey(CONFIG.devnet.usdcMint);

  console.log(`wallet:      ${wallet.publicKey.toBase58()}`);
  console.log(`program:     ${program.programId.toBase58()}  (${explorerAddress(program.programId.toBase58())})`);
  console.log(`usdc mint:   ${usdcMint.toBase58()}`);

  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`SOL balance: ${solBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  console.log(`\nGET /api/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}`);
  const fixture = await fetchUpcomingWorldCupFixture();
  const kickoffTs = Math.floor(fixture.StartTime / 1000);
  console.log(
    `fixture:     ${fixture.FixtureId}  ${fixture.Participant1} vs ${fixture.Participant2}  kickoff ${new Date(fixture.StartTime).toISOString()}`,
  );

  const fixtureIdBn = new BN(fixture.FixtureId);
  const [market] = deriveMarket(BigInt(fixture.FixtureId));
  const [bet] = deriveBet(market, wallet.publicKey, BET_OUTCOME);

  console.log(`market PDA:  ${market.toBase58()}  (${explorerAddress(market.toBase58())})`);

  const marketAccountClient = (program.account as any)[MARKET_ACCOUNT];
  const betAccountClient = (program.account as any)[BET_ACCOUNT];

  const existingMarket = await marketAccountClient.fetchNullable(market);
  if (existingMarket) {
    console.log("Market already initialized — skipping initialize_market.");
  } else {
    const vault = getAssociatedTokenAddressSync(usdcMint, market, true);
    console.log(
      `\nGET initialize_market(${fixture.FixtureId}, "${fixture.Participant1}", "${fixture.Participant2}", ${kickoffTs})`,
    );
    const initSig = await program.methods
      .initializeMarket(
        fixtureIdBn,
        fixture.Participant1,
        fixture.Participant2,
        new BN(kickoffTs),
      )
      .accountsStrict({
        authority: wallet.publicKey,
        market,
        usdcMint,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`initialize_market tx: ${initSig}  (${explorerTx(initSig)})`);
  }

  // Re-derive from the Market account itself rather than trusting the
  // locally-configured `usdcMint` — `market.usdc_mint` is fixed forever at
  // init time (see state.rs), so on a pre-existing market it's the only
  // authoritative source. This matters in practice, not just in theory: an
  // earlier run of this exact script hit an env-loading ordering bug that
  // silently initialized this market against the wrong mint (real Circle
  // devnet USDC, not our mock one) before the bug was fixed — every
  // token-moving instruction below has to follow whatever's actually on
  // the Market account, not what .env.local currently says.
  const marketForMint = existingMarket ?? (await marketAccountClient.fetch(market));
  const marketUsdcMint: PublicKey = marketForMint.usdcMint;
  const vault = getAssociatedTokenAddressSync(marketUsdcMint, market, true);
  if (!marketUsdcMint.equals(usdcMint)) {
    console.log(
      `\nNote: this market's usdc_mint (${marketUsdcMint.toBase58()}) differs from the ` +
        `configured mock mint (${usdcMint.toBase58()}) — using the market's own mint for ` +
        `the bet below, since that's what's actually enforced on-chain.`,
    );
  }

  const userUsdc = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    marketUsdcMint,
    wallet.publicKey,
  );
  if (userUsdc.amount < BigInt(BET_AMOUNT_USDC)) {
    if (marketUsdcMint.equals(usdcMint)) {
      console.log(
        `\nMinting ${BET_AMOUNT_USDC / 1_000_000} USDC to dev wallet (mint authority is this wallet)...`,
      );
      await mintTo(
        connection,
        wallet,
        marketUsdcMint,
        userUsdc.address,
        wallet,
        BET_AMOUNT_USDC * 4, // headroom for repeated runs
      );
    } else {
      throw new Error(
        `Dev wallet holds ${userUsdc.amount} of ${marketUsdcMint.toBase58()} (need ` +
          `${BET_AMOUNT_USDC}) and this isn't our mock mint, so we have no mint authority ` +
          `to top it up — fund ${wallet.publicKey.toBase58()} with that token manually first.`,
      );
    }
  }

  console.log(
    `\nGET place_bet(outcome=${BET_OUTCOME}, amount=${BET_AMOUNT_USDC})`,
  );
  const betSig = await program.methods
    .placeBet(BET_OUTCOME, new BN(BET_AMOUNT_USDC))
    .accountsStrict({
      user: wallet.publicKey,
      market,
      bet,
      userUsdc: userUsdc.address,
      usdcMint: marketUsdcMint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log(`place_bet tx: ${betSig}  (${explorerTx(betSig)})`);

  const marketAcc = await marketAccountClient.fetch(market);
  const betAcc = await betAccountClient.fetch(bet);
  const vaultAcc = await getAccount(connection, vault);

  console.log("\n--- On-chain state after the bet ---");
  console.log(`Market   ${market.toBase58()}`);
  console.log(`  authority:   ${marketAcc.authority.toBase58()}`);
  console.log(`  fixtureId:   ${marketAcc.fixtureId.toString()}`);
  console.log(`  home/away:   ${marketAcc.home} / ${marketAcc.away}`);
  console.log(`  kickoffTs:   ${marketAcc.kickoffTs.toString()} (${new Date(marketAcc.kickoffTs.toNumber() * 1000).toISOString()})`);
  console.log(`  status:      ${Object.keys(marketAcc.status)[0]}`);
  console.log(`  pools:       [${marketAcc.pools.map((p: BN) => p.toString()).join(", ")}]`);
  console.log(`  totalPool:   ${marketAcc.totalPool.toString()}`);
  console.log(`Bet      ${bet.toBase58()}`);
  console.log(`  user:        ${betAcc.user.toBase58()}`);
  console.log(`  outcome:     ${betAcc.outcome}`);
  console.log(`  amount:      ${betAcc.amount.toString()}`);
  console.log(`  claimed:     ${betAcc.claimed}`);
  console.log(`Vault    ${vault.toBase58()}`);
  console.log(`  balance:     ${vaultAcc.amount.toString()} (${formatUsdc(vaultAcc.amount)} USDC)`);

  console.log("\n--- Explorer links ---");
  console.log(`Program: ${explorerAddress(program.programId.toBase58())}`);
  console.log(`Market:  ${explorerAddress(market.toBase58())}`);
  console.log(`Bet:     ${explorerAddress(bet.toBase58())}`);
  console.log(`Vault:   ${explorerAddress(vault.toBase58())}`);
  console.log(`Bet tx:  ${explorerTx(betSig)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

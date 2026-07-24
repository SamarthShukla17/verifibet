/**
 * End-to-end proof that `void_market`/`claim_refund` work on real devnet,
 * without waiting out `void_and_refund.rs`'s real 24h `VOID_GRACE_PERIOD_SECS`.
 *
 * ## Why this needs its own throwaway program deployment
 *
 * `initialize_market` requires `kickoff_ts > Clock::get()?.unix_timestamp`
 * at creation time (see `initialize_market.rs`) — there's no way to create
 * a market whose kickoff is already 25h in the past; the earliest a fresh
 * market's kickoff can be is a few seconds from now. `void_market` then
 * requires `now > kickoff_ts + VOID_GRACE_PERIOD_SECS`, which is a real
 * 86,400 seconds on the production build. Combined, a synthetic market
 * created *now* genuinely cannot be voided on the production program for
 * a full day — there is no client-side trick around either check, both
 * are enforced on-chain.
 *
 * `void_and_refund.rs` already has an escape hatch for exactly this
 * problem, built for `anchor/tests/verifibet.ts`'s localnet suite: the
 * `test-mock-txline` Cargo feature shrinks `VOID_GRACE_PERIOD_SECS` from
 * 86,400 to 3 (see that file). This script reuses the *same* feature, but
 * deployed to **devnet** instead of a local validator, so the void +
 * refund transactions this script sends are real, confirmed, explorer-
 * visible devnet transactions — not a localnet simulation — while still
 * completing in seconds instead of a day.
 *
 * Concretely, this build was produced and deployed by hand (not through
 * this script, and not through `anchor deploy` — that command targets
 * whatever address `target/deploy/verifibet-keypair.json` holds, which
 * *is* the production upgrade authority's keypair, so using it here would
 * risk overwriting the real deployment):
 *
 * ```
 * cd anchor
 * anchor build --no-idl -p verifibet -- --tools-version v1.52 --features test-mock-txline
 * solana-keygen new --no-bip39-passphrase -o <scratch>/void-test-program-keypair.json
 * solana program deploy target/deploy/verifibet.so \
 *   --program-id <scratch>/void-test-program-keypair.json --url devnet
 * ```
 *
 * The IDL is untouched (still `idls/verifibet.json`, the production one) —
 * `test-mock-txline` only changes `resolve_market`'s CPI target and the
 * void grace-period constant, neither of which changes any instruction's
 * public interface, so the real, already-checked-in IDL describes this
 * build just as accurately.
 *
 * `VOID_TEST_PROGRAM_ID` below (`6CS6Lcd6u8iF6k96cag4yhv5eupQ8kmogHVMNARAaKZ3`)
 * is that deployment — a completely separate program from
 * `CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw` (this project's real
 * program, see `lib/solana/pda.ts#PROGRAM_ID`), with its own independent
 * PDA namespace. It never touches, and cannot affect, any real market or
 * bet — left deployed afterward the same way CLAUDE.md documents an
 * earlier stray `mock-txline` deployment being deliberately left alone
 * rather than closed (`DAkcQvNeL4zHoMikfi6rqTf9cQ3SSbBMHM15DLM8sikR`).
 * `lib/solana/pda.ts`'s derive functions aren't reused here (they're
 * hardcoded to the production `PROGRAM_ID` by design — see that file's
 * own doc comment on why); this script re-derives the same three PDAs
 * locally, parameterized by `VOID_TEST_PROGRAM_ID` instead.
 *
 * `keeper/void.ts#voidMarketJob` and `lib/solana/program.ts#claimRefund`
 * (the real code `keeper/index.ts` and `PositionRow`'s REFUND button call)
 * aren't invoked directly here for the same reason — both derive PDAs via
 * `lib/solana/pda.ts`'s production-pinned `deriveMarket`/`deriveBet`, so
 * they'd derive the wrong addresses against this test program. What *is*
 * shared: the exact same instruction names/accounts/args, sent through
 * the same already-checked-in IDL — this exercises the real on-chain
 * `void_market`/`claim_refund` logic for real, just via a standalone
 * client instead of the app's own wired-up code paths.
 *
 * Usage: `pnpm tsx scripts/synthetic-void-test.ts`
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
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";

import { CONFIG } from "@/lib/config";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import verifibetIdl from "@/lib/solana/idl/verifibet.json";

/** See this file's own doc comment. */
const VOID_TEST_PROGRAM_ID = new PublicKey("6CS6Lcd6u8iF6k96cag4yhv5eupQ8kmogHVMNARAaKZ3");

/** Obviously synthetic — chosen small and low so it can never be mistaken
 * for a real TxLINE fixture id (those are ~8-digit numbers), though a
 * collision would be harmless anyway: this program's PDA namespace is
 * entirely separate from production's. */
const FAKE_FIXTURE_ID = 1n;

/** test-mock-txline's shrunk grace period (see void_and_refund.rs) — a
 * few extra seconds of margin beyond it so the on-chain clock (which can
 * lag the wall clock slightly slot-to-slot) is unambiguously past it too. */
const SHRUNK_VOID_GRACE_PERIOD_SECS = 3;
const KICKOFF_LEAD_SECS = 8;
const SETTLE_MARGIN_SECS = 5;

const BET_AMOUNT_BASE_UNITS = 1_000_000n; // 1.000000 USDC

const MARKET_SEED = Buffer.from("market");
const BET_SEED = Buffer.from("bet");
const MARKET_ACCOUNT = "verifibet::state::market";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function u64LeBytes(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

function deriveTestMarket(fixtureId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, u64LeBytes(fixtureId)],
    VOID_TEST_PROGRAM_ID,
  )[0];
}

function deriveTestBet(market: PublicKey, user: PublicKey, outcome: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [BET_SEED, market.toBuffer(), user.toBuffer(), Buffer.from([outcome])],
    VOID_TEST_PROGRAM_ID,
  )[0];
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const wallet = loadKeypair(join(homedir(), ".config", "solana", "id.json"));
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const usdcMint = new PublicKey(CONFIG.devnet.usdcMint);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(
    { ...(verifibetIdl as anchor.Idl), address: VOID_TEST_PROGRAM_ID.toBase58() },
    provider,
  );

  const market = deriveTestMarket(FAKE_FIXTURE_ID);
  const bet = deriveTestBet(market, wallet.publicKey, 0);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey);
  const vault = getAssociatedTokenAddressSync(usdcMint, market, true);

  console.log(`wallet:       ${wallet.publicKey.toBase58()}`);
  console.log(`test program: ${VOID_TEST_PROGRAM_ID.toBase58()} (${explorerAddressUrl(VOID_TEST_PROGRAM_ID.toBase58())})`);
  console.log(`market PDA:   ${market.toBase58()}`);
  console.log(`bet PDA:      ${bet.toBase58()}\n`);

  const nowSecs = Math.floor(Date.now() / 1000);
  const kickoffTs = nowSecs + KICKOFF_LEAD_SECS;

  console.log(`[1/5] initialize_market (fixture ${FAKE_FIXTURE_ID}, kickoff in ${KICKOFF_LEAD_SECS}s)`);
  const initSig = await program.methods
    .initializeMarket(new BN(FAKE_FIXTURE_ID.toString()), "Synthetic Home", "Synthetic Away", new BN(kickoffTs))
    .accountsStrict({
      authority: wallet.publicKey,
      market,
      usdcMint,
      vault,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  initSig.feePayer = wallet.publicKey;
  console.log(`      tx: ${explorerTxUrl(await sendAndConfirmTransaction(connection, initSig, [wallet], { commitment: "confirmed" }))}`);

  console.log(`\n[2/5] place_bet (${BET_AMOUNT_BASE_UNITS} base units on outcome 0, before kickoff)`);
  const placeBetTx = await program.methods
    .placeBet(0, new BN(BET_AMOUNT_BASE_UNITS.toString()))
    .accountsStrict({
      user: wallet.publicKey,
      market,
      bet,
      userUsdc,
      usdcMint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .transaction();
  placeBetTx.feePayer = wallet.publicKey;
  console.log(`      tx: ${explorerTxUrl(await sendAndConfirmTransaction(connection, placeBetTx, [wallet], { commitment: "confirmed" }))}`);

  const waitSecs = KICKOFF_LEAD_SECS + SHRUNK_VOID_GRACE_PERIOD_SECS + SETTLE_MARGIN_SECS;
  console.log(`\n[3/5] waiting ${waitSecs}s for kickoff + the (test-mock-txline-shrunk) ${SHRUNK_VOID_GRACE_PERIOD_SECS}s void grace period to pass…`);
  await sleep(waitSecs * 1000);

  console.log(`\n[4/5] void_market`);
  const voidTx = await program.methods
    .voidMarket()
    .accountsStrict({ authority: wallet.publicKey, market })
    .transaction();
  voidTx.feePayer = wallet.publicKey;
  const voidSig = await sendAndConfirmTransaction(connection, voidTx, [wallet], { commitment: "confirmed" });
  console.log(`      tx: ${explorerTxUrl(voidSig)}`);

  const marketClient = (program.account as Record<string, { fetch(addr: PublicKey): Promise<{ status: Record<string, unknown> }> }>)[
    MARKET_ACCOUNT
  ];
  const decoded = await marketClient.fetch(market);
  const statusName = Object.keys(decoded.status)[0];
  console.log(`      market.status is now: ${statusName}`);
  if (statusName !== "voided") throw new Error(`expected status "voided", got "${statusName}"`);

  console.log(`\n[5/5] claim_refund`);
  const refundTx = await program.methods
    .claimRefund()
    .accountsStrict({
      user: wallet.publicKey,
      market,
      bet,
      vault,
      userUsdc,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
  refundTx.feePayer = wallet.publicKey;
  const refundSig = await sendAndConfirmTransaction(connection, refundTx, [wallet], { commitment: "confirmed" });
  console.log(`      tx: ${explorerTxUrl(refundSig)}`);

  console.log(`\n--- synthetic-void-test summary ---`);
  console.log(`market:  ${explorerAddressUrl(market.toBase58())}`);
  console.log(`void:    ${explorerTxUrl(voidSig)}`);
  console.log(`refund:  ${explorerTxUrl(refundSig)}`);
  console.log(`\none voided + refunded market on devnet, confirmed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

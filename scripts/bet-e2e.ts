/**
 * CLI: places a real bet (default 2 USDC) against an existing, genuinely
 * OPEN market — through the exact client code the UI uses
 * (lib/solana/pda.ts#deriveVault, lib/solana/program.ts#getProgram/
 * placeBet, lib/solana/sendTx.ts#sendAndConfirm), not a reimplementation —
 * and asserts the vault's on-chain USDC balance increased by exactly that
 * amount afterward. The dev keypair (`~/.config/solana/id.json`) is
 * wrapped in a small adapter satisfying just enough of
 * `WalletContextState`'s shape (`publicKey`, `signTransaction`,
 * `signAllTransactions`, `sendTransaction`) for both `getProgram` and
 * `sendAndConfirm` to accept it unmodified.
 *
 * Usage: pnpm tsx scripts/bet-e2e.ts <fixtureId> [outcome=0] [amountUsdc=2]
 *
 * The market must already exist (see scripts/sync-markets.ts) and still
 * be before its own `kickoff_ts` — `place_bet`'s on-chain `KickoffPassed`
 * check doesn't care what the real World Cup calendar says, only what
 * that specific Market account's stored kickoff time is.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import { Connection, Keypair, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import { deriveMarket, deriveVault, PROGRAM_ID } from "@/lib/solana/pda";
import { getProgram, getReadOnlyProgram, MARKET_ACCOUNT_IDL_NAME, placeBet } from "@/lib/solana/program";
import { sendAndConfirm } from "@/lib/solana/sendTx";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import { formatUsdc } from "@/lib/format";
import type { Outcome } from "@/lib/types";

const KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Just enough of `WalletContextState` for `getProgram`/`sendAndConfirm`
 * to accept it — a real Keypair standing in for a browser wallet
 * extension, since this is a headless CLI. */
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

async function main() {
  const [fixtureIdArg, outcomeArg, amountArg] = process.argv.slice(2);
  if (!fixtureIdArg) {
    console.error("Usage: pnpm tsx scripts/bet-e2e.ts <fixtureId> [outcome=0] [amountUsdc=2]");
    process.exit(1);
  }

  const fixtureId = BigInt(fixtureIdArg);
  const outcome = (outcomeArg ? Number(outcomeArg) : 0) as Outcome;
  const amountUsdc = amountArg ? Number(amountArg) : 2;
  const amountBaseUnits = BigInt(Math.round(amountUsdc * 1_000_000));

  const { CONFIG } = await import("@/lib/config");
  const keypair = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const wallet = keypairWallet(keypair);

  console.log(`wallet:   ${keypair.publicKey.toBase58()}`);
  console.log(`program:  ${PROGRAM_ID.toBase58()}  (${explorerAddressUrl(PROGRAM_ID.toBase58())})`);
  console.log(`fixture:  ${fixtureId}   outcome: ${outcome}   amount: ${amountUsdc} USDC`);

  const [market] = deriveMarket(fixtureId);
  console.log(`market:   ${market.toBase58()}  (${explorerAddressUrl(market.toBase58())})`);

  const readOnly = await getReadOnlyProgram();
  const marketAccountClient = (
    readOnly.account as Record<
      string,
      { fetchNullable(addr: typeof market): Promise<Record<string, unknown> | null> }
    >
  )[MARKET_ACCOUNT_IDL_NAME];
  const marketAccount = await marketAccountClient.fetchNullable(market);
  if (!marketAccount) {
    throw new Error(
      `no Market account exists yet for fixture ${fixtureId} — run scripts/sync-markets.ts --fixture ${fixtureId} first`,
    );
  }
  console.log(`status:   ${Object.keys(marketAccount.status as object)[0]}`);
  console.log(
    `kickoff:  ${new Date((marketAccount.kickoffTs as { toNumber(): number }).toNumber() * 1000).toISOString()}`,
  );

  const vault = await deriveVault(marketAccount.usdcMint as Parameters<typeof deriveVault>[0], market);
  const vaultBefore = await getAccount(connection, vault);
  console.log(`vault before: ${vaultBefore.amount.toString()} (${formatUsdc(vaultBefore.amount)} USDC)`);

  const program = await getProgram(connection, wallet);
  const tx = await placeBet(program, { fixtureId, outcome, amountBaseUnits });

  console.log(`\nplacing bet via lib/solana/program.ts#placeBet + sendAndConfirm...`);
  const signature = await sendAndConfirm(connection, wallet, tx, { label: "Placing bet" });
  console.log(`tx:           ${signature}  (${explorerTxUrl(signature)})`);

  const vaultAfter = await getAccount(connection, vault);
  console.log(`vault after:  ${vaultAfter.amount.toString()} (${formatUsdc(vaultAfter.amount)} USDC)`);

  const delta = vaultAfter.amount - vaultBefore.amount;
  console.log(`vault delta:  ${delta.toString()} (expected ${amountBaseUnits.toString()})`);

  if (delta !== amountBaseUnits) {
    throw new Error(`vault delta mismatch: expected ${amountBaseUnits}, got ${delta}`);
  }

  console.log(`\n✅ VERIFIED — vault increased by exactly ${formatUsdc(amountBaseUnits)} USDC.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

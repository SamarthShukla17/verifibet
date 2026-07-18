/**
 * Proves the TS <-> devnet loop: loads the local CLI keypair, connects to
 * the configured cluster RPC, and prints SOL balance + latest blockhash.
 *
 * Usage: pnpm devnet:check
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import { CLUSTER, NETWORK } from "@/lib/config";

const KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const keypair = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(NETWORK.rpcUrl, "confirmed");

  const [balanceLamports, { blockhash, lastValidBlockHeight }] =
    await Promise.all([
      connection.getBalance(keypair.publicKey),
      connection.getLatestBlockhash(),
    ]);

  console.log(`cluster:              ${CLUSTER}`);
  console.log(`rpc:                  ${NETWORK.rpcUrl}`);
  console.log(`wallet:               ${keypair.publicKey.toBase58()}`);
  console.log(
    `SOL balance:          ${balanceLamports / LAMPORTS_PER_SOL} SOL (${balanceLamports} lamports)`,
  );
  console.log(`latest blockhash:     ${blockhash}`);
  console.log(`last valid block ht:  ${lastValidBlockHeight}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

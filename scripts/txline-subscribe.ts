/**
 * Subscribes the dev wallet to TxLINE Service Level 1 (World Cup & Int'l
 * Friendlies, devnet free tier) via the on-chain `subscribe` instruction.
 *
 * IDL source: anchor idl fetch <txlineProgramId> -o anchor/idls/txline.json
 * --provider.cluster devnet (already fetched — see anchor/idls/txline.json).
 * Accounts/seeds not present in the IDL (pricing_matrix, token_treasury_v2)
 * came from TxODDS's own example at
 * github.com/txodds/tx-on-chain/blob/main/examples/devnet/common/users.ts,
 * cross-checked against documentation/programs/devnet.mdx and
 * documentation/subscription-tiers.mdx in the same repo.
 *
 * Usage: pnpm tsx scripts/txline-subscribe.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { NETWORK } from "@/lib/config";
import txlineIdl from "../anchor/idls/txline.json";

const KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");
const OUT_PATH = join(process.cwd(), ".txline-subscription.json");

const SERVICE_LEVEL_ID = 1; // World Cup & Int'l Friendlies — free on devnet
const DURATION_WEEKS = 4; // minimum term; must be a multiple of 4

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const wallet = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(NETWORK.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" },
  );

  const program = new anchor.Program(
    txlineIdl as anchor.Idl,
    provider,
  );

  const tokenMint = new PublicKey(NETWORK.txlTokenMint);
  console.log(`program:     ${program.programId.toBase58()}`);
  console.log(`wallet:      ${wallet.publicKey.toBase58()}`);
  console.log(`TxL mint:    ${tokenMint.toBase58()}`);

  // TxL is a Token-2022 mint (confirmed against TxODDS's own example code).
  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const ataInfo = await connection.getAccountInfo(userTokenAccount);
  if (!ataInfo) {
    console.log(`Creating TxL ATA at ${userTokenAccount.toBase58()}...`);
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userTokenAccount,
        wallet.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    const ataSig = await anchor.web3.sendAndConfirmTransaction(
      connection,
      createAtaTx,
      [wallet],
      { commitment: "confirmed" },
    );
    console.log(`TxL ATA created: ${ataSig}`);
  } else {
    console.log(`TxL ATA already exists: ${userTokenAccount.toBase58()}`);
  }

  // The IDL's only devnet faucet instruction (`request_devnet_faucet`) mints
  // USDT, not TxL — there is no TxL-specific faucet to call here. Service
  // Level 1 is priced at 0 TxL/week on devnet (confirmed below), so the free
  // tier doesn't need a funded ATA, just one that exists.
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId,
  );
  const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
  const row = (matrix.rows as any[]).find((r) => r.rowId === SERVICE_LEVEL_ID);
  if (!row) {
    throw new Error(
      `Service level ${SERVICE_LEVEL_ID} not found in pricing matrix at ${pricingMatrixPda.toBase58()}`,
    );
  }
  console.log(
    `Service level ${SERVICE_LEVEL_ID} price: ${row.pricePerWeekToken} TxL/week`,
  );

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  console.log(
    `Subscribing: service level ${SERVICE_LEVEL_ID}, ${DURATION_WEEKS} weeks...`,
  );

  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc({ commitment: "confirmed" });

  console.log(`Subscribed. txSig: ${txSig}`);

  const record = {
    txSig,
    serviceLevelId: SERVICE_LEVEL_ID,
    weeks: DURATION_WEEKS,
    wallet: wallet.publicKey.toBase58(),
    subscribedAt: new Date().toISOString(),
  };
  writeFileSync(OUT_PATH, JSON.stringify(record, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

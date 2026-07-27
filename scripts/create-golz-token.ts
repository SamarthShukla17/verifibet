/**
 * One-time mint: creates GOLZ, VERIFIBET's own devnet settlement token —
 * a real classic-SPL-Token mint with full on-chain Metaplex metadata
 * (name/symbol/image/description), not a bare unlabeled mint. Exists so
 * a new `Market` can be initialized with `usdc_mint = <GOLZ mint>`
 * instead of Circle's real devnet USDC — `initialize_market`'s `usdc_mint`
 * account has no hardcoded address check (see
 * `anchor/programs/verifibet/src/instructions/initialize_market.rs`), so
 * this needs zero program changes to be accepted; every downstream
 * instruction (`place_bet`, `claim_winnings`, `claim_refund`) already
 * re-reads the mint from the market's own stored field rather than
 * assuming USDC (see `lib/solana/program.ts`).
 *
 * Decimals are 6, matching this app's own "money is always 6dp base
 * units" convention (CLAUDE.md) — so GOLZ can be used by `place_bet`'s
 * u64 math with no special-casing. Freeze authority is renounced (`null`)
 * as a standard real-token trust signal (can't be frozen after the
 * fact); mint authority stays with the deploying wallet, on purpose —
 * unlike Circle's USDC, this one *is* ours to keep minting from.
 *
 * Metadata (image + JSON) is uploaded to Arweave via Irys — the same
 * permanent, non-this-repo-dependent storage real tokens use, not a
 * link back into this GitHub repo that could 404 if the repo ever moves.
 *
 * Usage: pnpm tsx scripts/create-golz-token.ts
 * Writes: .golz-token.json (gitignored) — mint address, metadata URI,
 * tx signatures.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import { Connection, Keypair } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import {
  createV1,
  TokenStandard,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createSignerFromKeypair,
  signerIdentity,
  keypairIdentity,
  publicKey as umiPublicKey,
  percentAmount,
} from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair, fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";

import { NETWORK } from "@/lib/config";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";

const KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");
const LOGO_PATH = process.argv[2] ?? join(process.cwd(), "demo-assets", "golz-logo.png");
const OUT_PATH = join(process.cwd(), ".golz-token.json");

const DECIMALS = 6;
const INITIAL_SUPPLY = 10_000_000n * 10n ** BigInt(DECIMALS); // 10,000,000 GOLZ

const TOKEN_NAME = "Golazo";
const TOKEN_SYMBOL = "GOLZ";
const TOKEN_DESCRIPTION =
  "GOLZ is VERIFIBET's own devnet settlement token — real classic-SPL-Token " +
  "mint, real on-chain Metaplex metadata, zero real-world value. Created to " +
  "let a VERIFIBET market settle in something other than USDC, on Solana " +
  "devnet only.";

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const wallet = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(NETWORK.rpcUrl, "confirmed");

  console.log(`wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`RPC:    ${NETWORK.rpcUrl}`);

  // --- 1. Create the mint (classic SPL Token — Anchor program's
  // `usdc_mint`/`token_program` accounts are typed against `anchor_spl::
  // token`, not `token_2022`) ---
  console.log(`\nCreating mint (decimals=${DECIMALS})...`);
  const mint = await createMint(
    connection,
    wallet,
    wallet.publicKey, // mint authority — stays with this wallet
    wallet.publicKey, // freeze authority for now — renounced below
    DECIMALS,
  );
  console.log(`mint: ${mint.toBase58()}`);
  console.log(explorerAddressUrl(mint.toBase58()));

  // --- 2. Mint the initial supply to the deploying wallet ---
  console.log(`\nMinting ${INITIAL_SUPPLY / 10n ** BigInt(DECIMALS)} GOLZ to ${wallet.publicKey.toBase58()}...`);
  const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, wallet.publicKey);
  const mintSig = await mintTo(connection, wallet, mint, ata.address, wallet, INITIAL_SUPPLY);
  console.log(`mintTo: ${mintSig}`);
  console.log(explorerTxUrl(mintSig));

  // --- 3. Renounce freeze authority — a real token doesn't hold the
  // power to freeze its own holders' accounts after the fact ---
  console.log(`\nRenouncing freeze authority...`);
  const freezeRevokeSig = await setAuthority(
    connection,
    wallet,
    mint,
    wallet,
    AuthorityType.FreezeAccount,
    null,
  );
  console.log(`freeze authority revoked: ${freezeRevokeSig}`);

  // --- 4. Upload logo + metadata JSON to Arweave via Irys, then write
  // the on-chain Metaplex metadata account ---
  const umi = createUmi(NETWORK.rpcUrl).use(mplTokenMetadata()).use(irysUploader());
  const umiKeypair = fromWeb3JsKeypair(wallet);
  const umiSigner = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(umiSigner)).use(keypairIdentity(umiKeypair));

  console.log(`\nUploading logo (${LOGO_PATH}) to Arweave via Irys...`);
  const imageBuffer = readFileSync(LOGO_PATH);
  const { createGenericFile } = await import("@metaplex-foundation/umi");
  const imageFile = createGenericFile(imageBuffer, "golz-logo.png", { contentType: "image/png" });
  const [imageUri] = await umi.uploader.upload([imageFile]);
  console.log(`image: ${imageUri}`);

  console.log(`Uploading metadata JSON...`);
  const metadataUri = await umi.uploader.uploadJson({
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: TOKEN_DESCRIPTION,
    image: imageUri,
    external_url: "https://verifibet.vercel.app",
    properties: {
      category: "image",
      files: [{ uri: imageUri, type: "image/png" }],
    },
    tags: ["verifibet", "devnet", "test-token", "parimutuel"],
  });
  console.log(`metadata JSON: ${metadataUri}`);

  console.log(`\nWriting on-chain Metaplex metadata account...`);
  const mintUmiPk = fromWeb3JsPublicKey(mint);
  const metadataTx = await createV1(umi, {
    mint: umiPublicKey(mintUmiPk),
    authority: umiSigner,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: DECIMALS,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);
  const metadataSig = Buffer.from(metadataTx.signature).toString("base64");
  console.log(`metadata tx: ${metadataSig}`);

  const record = {
    mint: mint.toBase58(),
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    decimals: DECIMALS,
    mintAuthority: wallet.publicKey.toBase58(),
    freezeAuthority: null,
    initialSupply: INITIAL_SUPPLY.toString(),
    imageUri,
    metadataUri,
    mintTxSig: mintSig,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(OUT_PATH, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`\nGOLZ mint: ${mint.toBase58()}`);
  console.log(explorerAddressUrl(mint.toBase58()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Builds the keeper's on-chain identity — `KEEPER_SECRET_KEY` -> `Keypair`,
 * a devnet `Connection`, and the `verifibet` `anchor.Program` bound to
 * both. Shared by `keeper/index.ts`'s long-running loop and
 * `keeper/resolver.ts`'s CLI backfill so there's exactly one place this
 * wiring happens, not two copies that could drift (e.g. a different
 * `commitment` or program-id fallback in one but not the other).
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type pino from "pino";

import { CONFIG } from "@/lib/config";
import verifibetIdl from "@/lib/solana/idl/verifibet.json";
import { loadKeeperKeypair, type KeeperContext } from "@/keeper/jobs";

export async function buildKeeperContext(logger: pino.Logger): Promise<KeeperContext> {
  const secret = process.env.KEEPER_SECRET_KEY;
  if (!secret) throw new Error("KEEPER_SECRET_KEY is not set");
  const keeper = loadKeeperKeypair(secret);

  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keeper), {
    commitment: "confirmed",
  });
  const program = new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: programId.toBase58() }, provider);

  logger.info(
    { keeper: keeper.publicKey.toBase58(), program: program.programId.toBase58(), rpc: CONFIG.devnet.rpcUrl },
    "keeper identity",
  );

  return { connection, program, keeper };
}

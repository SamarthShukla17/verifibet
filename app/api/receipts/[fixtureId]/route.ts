/**
 * GET /api/receipts/:fixtureId — the shareable settlement receipt for
 * one fixture's market, or a clear 404 explaining why one doesn't exist
 * yet (`lib/receipts.ts#buildReceipt` throws `ReceiptNotAvailableError`
 * for both real "not yet" cases; anything else is a genuine 500).
 *
 * Read-only: this route never signs or sends a transaction, so it
 * doesn't need a real wallet/secret key at all. `readOnlyWallet` below
 * hand-rolls the minimal object Anchor's `AnchorProvider` needs as its
 * `wallet` param (`publicKey` + no-op `signTransaction`/
 * `signAllTransactions`, never actually called; inferred structurally,
 * not imported by name — see why not, next) rather than constructing
 * `anchor.Wallet` (`NodeWallet`) itself — that class's real
 * implementation transitively requires `rpc-websockets` -> `uuid`, and
 * under Next's webpack bundler specifically (confirmed empirically;
 * identical code runs fine via `tsx` in
 * `scripts/devnet-e2e.ts`/`scripts/sync-markets.ts`, which use Node's
 * own module resolution) that chain fails to bundle ("`Wallet` is not
 * exported from `@coral-xyz/anchor`" at runtime, despite type-checking
 * fine — a bundling-only failure, not a type error). The package's
 * top-level `Wallet` *export* is confusingly `NodeWallet` itself (a
 * class, requiring a `payer` field), not the plain structural `Wallet`
 * *interface* `AnchorProvider`'s constructor actually accepts (a
 * same-name shadow, defined separately in `provider.d.ts`) — so even a
 * type-only import of "Wallet" pulls in the wrong shape. Passing an
 * untyped object literal directly lets it structurally check against
 * whatever `AnchorProvider`'s constructor really wants.
 * `runtime = "nodejs"` since `@coral-xyz/anchor` isn't edge-compatible.
 */
import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { buildReceipt, ReceiptNotAvailableError } from "@/lib/receipts";
import { CONFIG } from "@/lib/config";
import verifibetIdl from "@/lib/solana/idl/verifibet.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readOnlyWallet(keypair: Keypair) {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
  };
}

// Same construction pattern as scripts/devnet-e2e.ts and
// scripts/sync-markets.ts, minus the real wallet those need for signing
// — this is the first read-only call site; worth extracting into a
// shared lib/solana/ helper if a fourth one appears (the keeper,
// Session 6.4, likely will).
function getReadOnlyProgram(): anchor.Program {
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, readOnlyWallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
  );
  return new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: programId.toBase58() }, provider);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fixtureId: string }> },
) {
  const { fixtureId: fixtureIdParam } = await params;
  const fixtureId = Number(fixtureIdParam);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return NextResponse.json(
      { status: "invalid_fixture_id", message: `"${fixtureIdParam}" is not a valid fixture id` },
      { status: 400 },
    );
  }

  const program = getReadOnlyProgram();

  try {
    const receipt = await buildReceipt(program.provider.connection, program, fixtureId);
    return NextResponse.json(receipt);
  } catch (err) {
    if (err instanceof ReceiptNotAvailableError) {
      return NextResponse.json({ status: err.reason, message: err.message }, { status: 404 });
    }
    console.error(`[api/receipts] fixture ${fixtureId}:`, err);
    return NextResponse.json(
      { status: "internal_error", message: "failed to build receipt" },
      { status: 500 },
    );
  }
}

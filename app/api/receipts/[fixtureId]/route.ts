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
 *
 * `getReadOnlyProgram` itself now lives in lib/solana/program.ts — this
 * was the first read-only call site, extracted out once a fourth
 * (app/api/markets/[fixtureId]/route.ts) needed the exact same thing.
 */
import { NextResponse } from "next/server";
import { buildReceipt, ReceiptNotAvailableError } from "@/lib/receipts";
import { getReadOnlyProgram } from "@/lib/solana/program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

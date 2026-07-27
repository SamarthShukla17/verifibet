/**
 * GET /api/markets — every synced market's `fixtureId`/`totalPool`, one
 * RPC call (`lib/solana/market.ts#fetchAllMarketPools`) covering every
 * fixture at once. Backs the matches list's pool footer
 * (`lib/hooks/useMarketPools.ts`) — `/api/markets/:fixtureId` stays the
 * single-fixture route the match-detail page's pool panel polls; this is
 * the list-page equivalent, so a card doesn't need its own per-fixture
 * on-chain read (see `MatchesBoard.tsx`'s doc comment on why that used to
 * be `0n` unconditionally).
 *
 * `runtime = "nodejs"` — same reason as every other route reading through
 * `getReadOnlyProgram()`: `@coral-xyz/anchor` isn't edge-compatible.
 */
import { NextResponse } from "next/server";
import { fetchAllMarketPools } from "@/lib/solana/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pools = await fetchAllMarketPools();
    return NextResponse.json(pools, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (err) {
    console.error("[api/markets] batch fetch failed:", err);
    return NextResponse.json({ message: "failed to read market accounts" }, { status: 500 });
  }
}

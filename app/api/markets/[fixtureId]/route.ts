/**
 * GET /api/markets/:fixtureId — the on-chain `Market` account's pools +
 * status + a distinct-bettor count, for the match-detail page's pool
 * panel (polled client-side every 15s, see
 * lib/hooks/useMarketAccount.ts). `synced: false` (not a 404) when no
 * `Market` account exists yet for this fixture — a real, common state
 * (see lib/solana/market.ts's own doc comment), not an error; the panel
 * renders an honest "not yet on-chain" state for it instead of failing.
 *
 * `runtime = "nodejs"` — same reason as app/api/receipts/[fixtureId]:
 * `@coral-xyz/anchor` isn't edge-compatible.
 */
import { NextResponse } from "next/server";
import { fetchBettorCount, fetchMarketAccount } from "@/lib/solana/market";

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
      { message: `"${fixtureIdParam}" is not a valid fixture id` },
      { status: 400 },
    );
  }

  try {
    const market = await fetchMarketAccount(fixtureId);
    if (!market) {
      return NextResponse.json({ synced: false as const });
    }

    const bettorCount = await fetchBettorCount(fixtureId);
    return NextResponse.json({ synced: true as const, ...market, bettorCount });
  } catch (err) {
    console.error(`[api/markets] fixture ${fixtureId}:`, err);
    return NextResponse.json({ message: "failed to read market account" }, { status: 500 });
  }
}

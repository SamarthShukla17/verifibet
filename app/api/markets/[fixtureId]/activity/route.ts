/**
 * GET /api/markets/:fixtureId/activity — recent `BetPlaced` events for
 * this fixture's market, for the match-detail page's Activity tab. Empty
 * array (never an error) both when no `Market` account exists yet and
 * when one exists but has no bets — both are normal, real states.
 */
import { NextResponse } from "next/server";
import { fetchRecentBetActivity } from "@/lib/solana/activity";

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
    const activity = await fetchRecentBetActivity(fixtureId);
    return NextResponse.json({ activity });
  } catch (err) {
    console.error(`[api/markets/activity] fixture ${fixtureId}:`, err);
    return NextResponse.json({ message: "failed to read activity" }, { status: 500 });
  }
}

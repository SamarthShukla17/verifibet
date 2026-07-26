/**
 * Normalized fixtures + live status, read straight from the shared
 * `StatusTracker` singleton (`lib/txline/statusTracker.ts`) rather than
 * hitting TxLINE per-request — every request in this process shares one
 * hydration and one set of live SSE subscriptions.
 *
 * `runtime = "nodejs"`: the tracker's singleton pulls in `node:events`
 * and the same long-lived stream machinery `app/api/stream/route.ts`
 * needs, neither of which the edge runtime supports. `dynamic =
 * "force-dynamic"`: the response body comes from an in-memory Map that
 * changes between requests — Next must not try to statically optimize or
 * build-time-cache this route. The 15s `Cache-Control` below is a plain
 * HTTP header instead, so a CDN/browser in front of this route can still
 * cache it without Next's own data cache getting involved.
 */
import { NextResponse } from "next/server";
import { getStatusTracker } from "@/lib/txline/statusTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tracker = await getStatusTracker();

  // `X-Fixtures-Stale` (not a body field): the response body stays a
  // plain `TrackedFixture[]` — every existing caller (`useMyBets`,
  // `MatchDetailBoard`, `app/matches/(list)/page.tsx`, ...) parses it as
  // an array directly, and wrapping it in `{ fixtures, stale }` would be
  // a breaking change across all of them. A header lets
  // `components/FixturesStaleBanner.tsx` (the one consumer that actually
  // cares) read the flag without touching that contract.
  return NextResponse.json(tracker.list(), {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
      "X-Fixtures-Stale": String(tracker.isFixturesStale()),
    },
  });
}

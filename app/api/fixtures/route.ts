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

  return NextResponse.json(tracker.list(), {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
    },
  });
}

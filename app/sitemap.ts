import type { MetadataRoute } from "next";
import { getStatusTracker } from "@/lib/txline/statusTracker";

/** Same `NEXT_PUBLIC_APP_URL` env var `keeper/resolver.ts`/`keeper/
 * demoResolver.ts` and `app/layout.tsx`'s `metadataBase` already use for
 * this app's own canonical origin — not a new convention. Read directly
 * (not via `lib/baseUrl.ts#getBaseUrl`) because that helper reads
 * `next/headers`, which isn't available here: `sitemap.ts` has no
 * incoming request to derive a host from. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * `/matches` itself plus one entry per real fixture — `getStatusTracker`
 * directly (the same singleton `app/api/fixtures/route.ts` reads from),
 * not a self-fetch through that route: same "no incoming request to
 * derive a host from" reasoning as `APP_URL` above, and it's the exact
 * same data either way.
 *
 * Demo-range fixtures (`isDemo`) are excluded — this app is deliberately
 * honest elsewhere about demo vs. real data (see `DemoReplayBanner.tsx`,
 * `lib/receipts.ts`'s `attested` handling); a synthetic scenario fixture
 * isn't real World Cup content worth a search engine indexing, and its
 * fixture ID/URL isn't stable across a `scripts/rearm-scenario.ts` reset
 * the way a real one is.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tracker = await getStatusTracker();
  const fixtures = tracker.list().filter((f) => !f.isDemo);

  const matchEntries: MetadataRoute.Sitemap = fixtures.map((fixture) => ({
    url: `${APP_URL}/matches/${fixture.fixtureId}`,
    lastModified: new Date(fixture.lastEventTs),
    changeFrequency: fixture.status === "LIVE" ? "always" : fixture.status === "SCHEDULED" ? "hourly" : "daily",
    priority: fixture.status === "LIVE" ? 1 : 0.7,
  }));

  return [
    {
      url: APP_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${APP_URL}/matches`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.9,
    },
    ...matchEntries,
  ];
}

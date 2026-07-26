import type { MetadataRoute } from "next";

/** Same `NEXT_PUBLIC_APP_URL` convention as `app/layout.tsx`'s
 * `metadataBase` and `app/sitemap.ts` — see that file's own comment. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * `/dev/` is the only real disallow — `app/dev/components/page.tsx`'s
 * own doc comment already says it: "Not linked from anywhere in the
 * real app," a component gallery against mock data, not content. `/api/`
 * is deliberately *not* disallowed: `/api/og/bet` and `/api/og/match`
 * are exactly what a link-unfurl bot (Telegram, X, Discord, ...) fetches
 * to build a preview card, and most of those bots don't honor
 * `robots.txt` for image fetches anyway — a broad `/api/` disallow risks
 * silently breaking the previews this whole task exists to produce, for
 * a search-indexing concern (JSON/image endpoints showing up as their
 * own search results) that was never real to begin with.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dev/"],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}

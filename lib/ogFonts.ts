/**
 * Shared by every `ImageResponse`-based generator in this app
 * (`app/api/og/bet/route.tsx`, `app/(marketing)/opengraph-image.tsx`,
 * `app/api/og/match/route.tsx`) — extracted here once a second call site
 * needed the exact same thing the first one did.
 *
 * Google Fonts' CSS2 endpoint serves TTF (not WOFF2) to a plain `fetch`
 * with no `Accept` header — Satori (what `ImageResponse` renders with)
 * can only parse TTF/OTF, not WOFF2, which is what a real browser would
 * get from the same URL. `text` scopes the returned subset to only the
 * glyphs a given card actually uses, keeping the fetch small. Returns
 * `null` (never throws) on any failure — Satori falls back to its own
 * default font, so a Google Fonts hiccup degrades a card's typography,
 * it doesn't break the image.
 */
export async function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl)).text();
    const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
    if (!match) return null;
    return await (await fetch(match[1])).arrayBuffer();
  } catch {
    return null;
  }
}

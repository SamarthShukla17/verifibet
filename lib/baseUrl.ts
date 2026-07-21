import { headers } from "next/headers";

/**
 * `fetch` needs an absolute URL even for our own route — there's no env
 * var for this yet (see CLAUDE.md), so derive it from the incoming
 * request's own `Host` header, same as any reverse-proxied Next app has
 * to. `x-forwarded-proto` covers the common "behind a proxy that
 * terminates TLS" deployment shape; falling back to `http` matches local
 * dev, where that header is never set. Server Components only (reads
 * `next/headers`) — extracted here once a second call site
 * (app/matches/[fixtureId]/page.tsx) needed the exact same thing
 * app/matches/(list)/page.tsx already did.
 */
export function getBaseUrl(): string {
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

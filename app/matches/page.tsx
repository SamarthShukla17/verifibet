import { headers } from "next/headers";
import { MatchesBoard } from "@/components/market/MatchesBoard";
import { organizeMatches, parseMarketFilters } from "@/lib/market";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

/** `fetch` needs an absolute URL even for our own route — there's no env
 * var for this yet (see CLAUDE.md), so derive it from the incoming
 * request's own `Host` header, same as any reverse-proxied Next app has
 * to. `x-forwarded-proto` covers the common "behind a proxy that
 * terminates TLS" deployment shape; falling back to `http` matches local
 * dev, where that header is never set. */
function getBaseUrl(): string {
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

function toParamsGetter(searchParams: { [key: string]: string | string[] | undefined }) {
  return {
    get(key: string): string | null {
      const value = searchParams[key];
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value[0] ?? null;
      return null;
    },
  };
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const filters = parseMarketFilters(toParamsGetter(searchParams));

  const res = await fetch(`${getBaseUrl()}/api/fixtures`, { next: { revalidate: 30 } });
  const fixtures: TrackedFixture[] = await res.json();

  const organized = organizeMatches(fixtures, filters);

  return <MatchesBoard organized={organized} />;
}

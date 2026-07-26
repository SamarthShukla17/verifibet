import { MatchesBoard } from "@/components/market/MatchesBoard";
import { organizeMatches, parseMarketFilters } from "@/lib/market";
import { getStatusTracker } from "@/lib/txline/statusTracker";

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

  // Reads the shared `StatusTracker` singleton directly rather than
  // self-fetching `/api/fixtures` over HTTP — that route does nothing but
  // call this same singleton (see its own doc comment), so the HTTP round
  // trip bought nothing but a real failure mode: a Vercel serverless
  // function calling its own public URL can intermittently get back an
  // HTML error page instead of JSON, which crashed this whole page with
  // `SyntaxError: Unexpected token '<'` in production (2026-07-26 — see
  // NOTES.md). Same fix `app/sitemap.ts` already uses, for the same
  // reason.
  const tracker = await getStatusTracker();
  const fixtures = tracker.list();

  const organized = organizeMatches(fixtures, filters);

  return <MatchesBoard organized={organized} />;
}

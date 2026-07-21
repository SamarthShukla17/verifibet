import { MatchesBoard } from "@/components/market/MatchesBoard";
import { organizeMatches, parseMarketFilters } from "@/lib/market";
import { getBaseUrl } from "@/lib/baseUrl";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

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

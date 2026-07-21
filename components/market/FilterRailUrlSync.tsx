"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterRail } from "@/components/market/FilterRail";
import { marketFiltersToSearchParams, parseMarketFilters, type MarketFilters } from "@/lib/market";

/**
 * Bridges `FilterRail`'s plain `{ filters, onChange }` prop contract to the
 * URL — the single source of truth for filter state (see lib/market.ts's
 * `parseMarketFilters`/`marketFiltersToSearchParams`), so a filtered view
 * is always a shareable link (`?stage=QF&status=open`) and the
 * server-rendered `app/matches/(list)/page.tsx` (which reads the same
 * `searchParams`) never disagrees with what this widget displays. No local
 * `filters` state here on purpose — `useSearchParams()` already reflects
 * the current URL on every render, so there's nothing to keep in sync.
 */
export function FilterRailUrlSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = parseMarketFilters(searchParams);

  function handleChange(next: MarketFilters) {
    const query = marketFiltersToSearchParams(next).toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return <FilterRail filters={filters} onChange={handleChange} />;
}

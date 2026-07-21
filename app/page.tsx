"use client";

import { useMemo, useState } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { FilterRail, DEFAULT_FILTERS, matchesFilters, type MarketFilters } from "@/components/market/FilterRail";
import { MatchCard } from "@/components/market/MatchCard";
import { BetSlip, type BetSlipSelection } from "@/components/bet/BetSlip";
import { cn } from "@/lib/utils";
import type { Fixture, MarketStatus, OddsSnapshot, Outcome } from "@/lib/types";

/**
 * Grid-shell mock data — real 2026 World Cup fixtures spanning group and
 * knockout stages so the filter rail has something to actually filter.
 * Fixed reference instant (not `Date.now()`), same reasoning as
 * app/dev/components/page.tsx: module-scope code runs once during SSR and
 * again during client hydration, at two different wall-clock moments, and
 * a `Date.now()`-derived value can flip the *text* a component renders
 * between those two passes and fail hydration.
 */
const NOW_TS = Math.floor(new Date("2026-07-21T12:00:00Z").getTime() / 1000);

interface MockMarket {
  fixture: Fixture;
  odds: OddsSnapshot | null;
  marketStatus: MarketStatus;
  live?: { minute?: number } | null;
  poolBaseUnits: bigint;
}

const MOCK_MARKETS: MockMarket[] = [
  {
    fixture: {
      fixtureId: 1,
      home: "France",
      away: "England",
      kickoffTs: NOW_TS + 2 * 86_400,
      stage: "GROUP",
      group: "A",
      status: "SCHEDULED",
    },
    odds: {
      fixtureId: 1,
      home: 2.4,
      draw: 3.3,
      away: 2.85,
      impliedPct: [39.2, 28.5, 32.3],
      overroundPct: 3.1,
      ts: NOW_TS * 1000,
    },
    marketStatus: "OPEN",
    poolBaseUnits: 12_450_000_000n,
  },
  {
    fixture: {
      fixtureId: 2,
      home: "Brazil",
      away: "Morocco",
      kickoffTs: NOW_TS + 3 * 86_400,
      stage: "GROUP",
      group: "B",
      status: "SCHEDULED",
    },
    odds: {
      fixtureId: 2,
      home: 1.65,
      draw: 3.9,
      away: 5.2,
      impliedPct: [56.1, 23.7, 20.2],
      overroundPct: 5.4,
      ts: NOW_TS * 1000,
    },
    marketStatus: "OPEN",
    poolBaseUnits: 4_200_000_000n,
  },
  {
    fixture: {
      fixtureId: 3,
      home: "Germany",
      away: "Paraguay",
      kickoffTs: NOW_TS - 5_000,
      stage: "R32",
      status: "LIVE",
    },
    odds: {
      fixtureId: 3,
      home: 1.95,
      draw: 3.4,
      away: 4.18,
      impliedPct: [48.6, 27.9, 23.5],
      overroundPct: 4.0,
      ts: NOW_TS * 1000,
    },
    marketStatus: "LOCKED",
    live: { minute: 67 },
    poolBaseUnits: 18_600_000_000n,
  },
  {
    fixture: {
      fixtureId: 4,
      home: "Argentina",
      away: "Japan",
      kickoffTs: NOW_TS - 40_000,
      stage: "R16",
      status: "LIVE",
    },
    odds: {
      fixtureId: 4,
      home: 1.4,
      draw: 4.6,
      away: 7.5,
      impliedPct: [66.8, 20.3, 12.9],
      overroundPct: 5.7,
      ts: NOW_TS * 1000,
    },
    marketStatus: "LOCKED",
    live: { minute: 23 },
    poolBaseUnits: 9_875_000_000n,
  },
  {
    fixture: {
      fixtureId: 5,
      home: "Portugal",
      away: "Netherlands",
      kickoffTs: NOW_TS - 3 * 86_400,
      stage: "QF",
      status: "FINISHED",
    },
    odds: null,
    marketStatus: "RESOLVED",
    poolBaseUnits: 22_300_000_000n,
  },
  {
    fixture: {
      fixtureId: 6,
      home: "Spain",
      away: "Croatia",
      kickoffTs: NOW_TS - 5 * 86_400,
      stage: "SF",
      status: "FINISHED",
    },
    odds: null,
    marketStatus: "RESOLVED",
    poolBaseUnits: 31_050_500_000n,
  },
  {
    fixture: {
      fixtureId: 7,
      home: "Colombia",
      away: "Senegal",
      kickoffTs: NOW_TS - 6 * 86_400,
      stage: "GROUP",
      group: "C",
      status: "CANCELLED",
    },
    odds: null,
    marketStatus: "VOIDED",
    poolBaseUnits: 0n,
  },
  {
    fixture: {
      fixtureId: 8,
      home: "USA",
      away: "Belgium",
      kickoffTs: NOW_TS + 6 * 86_400,
      stage: "FINAL",
      status: "SCHEDULED",
    },
    odds: {
      fixtureId: 8,
      home: 2.1,
      draw: 3.5,
      away: 3.2,
      impliedPct: [45.0, 27.0, 28.0],
      overroundPct: 3.8,
      ts: NOW_TS * 1000,
    },
    marketStatus: "OPEN",
    poolBaseUnits: 44_800_000_000n,
  },
];

export default function Home() {
  const [filters, setFilters] = useState<MarketFilters>(DEFAULT_FILTERS);
  const [selection, setSelection] = useState<{ fixtureId: number; outcome: Outcome } | null>(null);
  const [betAmount, setBetAmount] = useState("25");

  const filtered = useMemo(
    () => MOCK_MARKETS.filter((m) => matchesFilters(m.fixture, m.marketStatus, filters)),
    [filters],
  );

  const selectedMarket = selection
    ? filtered.find((m) => m.fixture.fixtureId === selection.fixtureId)
    : undefined;

  const betSlipSelection: BetSlipSelection | null =
    selection && selectedMarket && selectedMarket.odds
      ? {
          fixtureId: selectedMarket.fixture.fixtureId,
          home: selectedMarket.fixture.home,
          away: selectedMarket.fixture.away,
          outcome: selection.outcome,
          odds: [selectedMarket.odds.home, selectedMarket.odds.draw, selectedMarket.odds.away][
            selection.outcome
          ],
        }
      : null;

  // Real per-market pools would come from the on-chain Market account,
  // split by outcome — the mock dataset only tracks one total per market,
  // so estimatePayout gets an even 3-way split of it as a placeholder.
  const pools: [bigint, bigint, bigint] = selectedMarket
    ? [
        selectedMarket.poolBaseUnits / 3n,
        selectedMarket.poolBaseUnits / 3n,
        selectedMarket.poolBaseUnits / 3n,
      ]
    : [0n, 0n, 0n];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:flex lg:items-start lg:gap-8">
        <FilterRail filters={filters} onChange={setFilters} />

        <main className="min-w-0 flex-1 pb-24 lg:pb-0">
          <div className="mb-4 mt-4 flex items-center justify-between gap-3 lg:mt-0">
            <p className="text-sm text-muted-foreground">
              {filtered.length} match{filtered.length === 1 ? "" : "es"}
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No matches for these filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((m) => (
                <MatchCard
                  key={m.fixture.fixtureId}
                  fixture={m.fixture}
                  odds={m.odds}
                  marketStatus={m.marketStatus}
                  live={m.live}
                  totalPoolBaseUnits={m.poolBaseUnits}
                  selectedOutcome={
                    selection?.fixtureId === m.fixture.fixtureId ? selection.outcome : null
                  }
                  onSelectOutcome={(outcome) =>
                    setSelection({ fixtureId: m.fixture.fixtureId, outcome })
                  }
                />
              ))}
            </div>
          )}
        </main>

        <aside className="lg:w-80 lg:shrink-0">
          <BetSlip
            selection={betSlipSelection}
            pools={pools}
            amount={betAmount}
            onAmountChange={setBetAmount}
            onSubmit={() => alert("Shell only — no place_bet wiring yet.")}
          />
        </aside>
      </div>

      <Footer />

      {/*
       * BetSlip is `fixed inset-x-0 bottom-0` below `lg` (see its own
       * lg:sticky override), so it overlaps whatever is at the bottom of
       * the viewport regardless of scroll position — including the
       * footer just above, which sits earlier in document flow but ends
       * exactly at the document's end, coincident with the fixed sheet.
       * This trailing spacer buys back the scroll room needed for the
       * footer's real content to clear the sheet before scrolling bottoms
       * out. Sized from the two states BetSlip actually renders (measured:
       * ~82px empty, ~363px with a selection), not guessed.
       */}
      <div aria-hidden className={cn("lg:hidden", selection ? "h-[26rem]" : "h-28")} />
    </div>
  );
}

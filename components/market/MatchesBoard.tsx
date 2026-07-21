"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { MatchCard } from "@/components/market/MatchCard";
import { LiveMatchCard } from "@/components/market/LiveMatchCard";
import { BetSlip, type BetSlipSelection } from "@/components/bet/BetSlip";
import { Button } from "@/components/ui/button";
import type { OrganizedMatches, MarketEntry } from "@/lib/market";
import type { Outcome } from "@/lib/types";

interface Selection {
  fixtureId: number;
  outcome: Outcome;
  /** Whatever the clicked card showed at the moment of selection — see
   * MatchCard's `onSelectOutcome` doc comment. */
  odds: number;
}

function EntryCard({
  entry,
  selectedOutcome,
  onSelectOutcome,
}: {
  entry: MarketEntry;
  selectedOutcome: Outcome | null;
  onSelectOutcome: (outcome: Outcome, odds: number) => void;
}) {
  if (entry.fixture.status === "LIVE") {
    return (
      <LiveMatchCard
        fixture={entry.fixture}
        marketStatus={entry.marketStatus}
        selectedOutcome={selectedOutcome}
        onSelectOutcome={onSelectOutcome}
      />
    );
  }

  return (
    <MatchCard
      fixture={entry.fixture}
      odds={null}
      marketStatus={entry.marketStatus}
      totalPoolBaseUnits={0n}
      selectedOutcome={selectedOutcome}
      onSelectOutcome={onSelectOutcome}
    />
  );
}

function EntryGrid({
  entries,
  selection,
  onSelect,
}: {
  entries: MarketEntry[];
  selection: Selection | null;
  onSelect: (fixtureId: number, outcome: Outcome, odds: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <EntryCard
          key={entry.fixture.fixtureId}
          entry={entry}
          selectedOutcome={selection?.fixtureId === entry.fixture.fixtureId ? selection.outcome : null}
          onSelectOutcome={(outcome, odds) => onSelect(entry.fixture.fixtureId, outcome, odds)}
        />
      ))}
    </div>
  );
}

export interface MatchesBoardProps {
  organized: OrganizedMatches;
}

export function MatchesBoard({ organized }: MatchesBoardProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [betAmount, setBetAmount] = useState("25");

  const allEntries = useMemo(
    () => [...organized.live, ...organized.upcomingByDay.flatMap((g) => g.entries), ...organized.earlier],
    [organized],
  );

  const handleSelect = (fixtureId: number, outcome: Outcome, odds: number) => {
    setSelection({ fixtureId, outcome, odds });
  };

  const selectedEntry = selection
    ? allEntries.find((e) => e.fixture.fixtureId === selection.fixtureId)
    : undefined;

  const betSlipSelection: BetSlipSelection | null =
    selection && selectedEntry
      ? {
          fixtureId: selection.fixtureId,
          home: selectedEntry.fixture.home,
          away: selectedEntry.fixture.away,
          outcome: selection.outcome,
          odds: selection.odds,
        }
      : null;

  return (
    <>
      <main className="min-w-0 flex-1 pb-24 lg:pb-0">
        <div className="mb-4 mt-4 flex items-center justify-between gap-3 lg:mt-0">
          <p className="text-sm text-muted-foreground">
            {organized.totalCount} match{organized.totalCount === 1 ? "" : "es"}
          </p>
        </div>

        {organized.totalCount === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
            <span className="text-4xl" aria-hidden>
              ⚽
            </span>
            <p className="font-display text-lg font-semibold text-foreground">
              Nothing on the pitch for that.
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              No matches fit these filters right now. Try a different stage or status, or clear the
              search.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/matches">Clear filters</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-10">
            {organized.live.length > 0 && (
              <section>
                <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-destructive">
                  Live Now
                </h2>
                <EntryGrid entries={organized.live} selection={selection} onSelect={handleSelect} />
              </section>
            )}

            {organized.upcomingByDay.map((group) => (
              <section key={group.dateKey}>
                <h2 className="sticky top-16 z-20 -mx-4 mb-3 border-b border-border bg-background/95 px-4 py-2 font-display text-sm font-semibold text-foreground backdrop-blur sm:-mx-6 sm:px-6">
                  {group.label}
                </h2>
                <EntryGrid entries={group.entries} selection={selection} onSelect={handleSelect} />
              </section>
            ))}

            {organized.earlier.length > 0 && (
              <details className="group rounded-xl border border-border bg-card/40">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  <span>Earlier · {organized.earlier.length} finished</span>
                  <ChevronDown
                    className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="border-t border-border p-4">
                  <EntryGrid entries={organized.earlier} selection={selection} onSelect={handleSelect} />
                </div>
              </details>
            )}
          </div>
        )}
      </main>

      <aside className="lg:w-80 lg:shrink-0">
        <BetSlip
          selection={betSlipSelection}
          pools={[0n, 0n, 0n]}
          amount={betAmount}
          onAmountChange={setBetAmount}
          onSubmit={() => alert("Shell only — no place_bet wiring yet.")}
        />
      </aside>
    </>
  );
}

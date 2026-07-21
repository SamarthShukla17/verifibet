"use client";

import { useLiveFixture } from "@/lib/hooks/useLiveFixture";
import { MatchCard } from "@/components/market/MatchCard";
import type { MarketStatus, Outcome } from "@/lib/types";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

export interface LiveMatchCardProps {
  fixture: TrackedFixture;
  marketStatus: MarketStatus;
  selectedOutcome: Outcome | null;
  onSelectOutcome: (outcome: Outcome, odds: number) => void;
}

/**
 * The ONLY place `useLiveFixture` gets called — and only ever mounted for
 * a fixture whose (server-fetched) status is already `LIVE` (see
 * `MatchesBoard`'s render branch). Every other fixture renders a plain
 * `MatchCard` with no subscription at all: opening one `EventSource` per
 * card for the full 104-match tournament would mean 104 concurrent SSE
 * connections on a single page load, which is exactly what this
 * component's narrow mount condition exists to prevent.
 */
export function LiveMatchCard({
  fixture,
  marketStatus,
  selectedOutcome,
  onSelectOutcome,
}: LiveMatchCardProps) {
  const live = useLiveFixture(fixture.fixtureId);
  const minute = live.score?.minute ?? fixture.score?.minute;

  return (
    <MatchCard
      fixture={fixture}
      odds={live.odds}
      marketStatus={marketStatus}
      live={{ minute }}
      totalPoolBaseUnits={0n}
      selectedOutcome={selectedOutcome}
      onSelectOutcome={onSelectOutcome}
    />
  );
}

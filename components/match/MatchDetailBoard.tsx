"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveFixture } from "@/lib/hooks/useLiveFixture";
import { useMarketAccount } from "@/lib/hooks/useMarketAccount";
import { fixtureStatusFromActionAndStatusId } from "@/lib/txline/normalize";
import { marketStatusFromFixtureStatus } from "@/lib/market";
import { MatchHeader } from "@/components/match/MatchHeader";
import { OddsChart } from "@/components/OddsChart";
import { OddsDisplay } from "@/components/market/OddsDisplay";
import { PoolPanel } from "@/components/match/PoolPanel";
import { ActivityTab } from "@/components/match/ActivityTab";
import { VerificationTab } from "@/components/match/VerificationTab";
import { BetSlip, type BetSlipSelection } from "@/components/bet/BetSlip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FixtureStage, FixtureStatus, MarketStatus, Outcome, ScoreEvent } from "@/lib/types";

export interface MatchDetailBoardProps {
  fixtureId: number;
  home: string;
  away: string;
  stage: FixtureStage;
  group?: string;
  kickoffTs: number;
  status: FixtureStatus;
  initialScore: ScoreEvent | null;
}

/**
 * One `useLiveFixture` subscription for the whole page — the tiles, the
 * chart, and the header's live score/minute all read from this single
 * hook call rather than each opening their own `EventSource` to the same
 * fixture (see LiveMatchCard.tsx's own doc comment for the sibling
 * constraint on the matches list, which this generalizes to "one
 * subscription per page" here since there's only ever one fixture on
 * screen at a time).
 */
export function MatchDetailBoard({
  fixtureId,
  home,
  away,
  stage,
  group,
  kickoffTs,
  status,
  initialScore,
}: MatchDetailBoardProps) {
  const live = useLiveFixture(fixtureId);
  const { market, loading: marketLoading } = useMarketAccount(fixtureId);

  // Starts from the server-fetched status and upgrades live as real
  // status-stream events arrive — the same mapping the tracker itself
  // uses (lib/txline/normalize.ts), so a viewer watching this exact page
  // can see a SCHEDULED match actually go LIVE without a reload.
  const [liveStatus, setLiveStatus] = useState<FixtureStatus>(status);
  useEffect(() => {
    if (!live.status) return;
    setLiveStatus(fixtureStatusFromActionAndStatusId(live.status.action, live.status.statusId));
  }, [live.status]);

  const isLive = liveStatus === "LIVE";
  // Prefer the real on-chain Market.status once one exists — the
  // TxLINE-fixture-status heuristic (marketStatusFromFixtureStatus) is
  // only a stand-in for pages with no on-chain market data at all (the
  // matches list); this page actually polls the real account, so a
  // market that's genuinely Resolved on-chain should never still say
  // "Open" just because TxLINE's own fixture status hasn't caught up.
  const marketStatus: MarketStatus =
    market?.synced && market.status
      ? (market.status.toUpperCase() as MarketStatus)
      : marketStatusFromFixtureStatus(liveStatus);
  const score = live.score ?? initialScore;

  const odds = live.odds;
  const prevOddsRef = useRef<{ home: number; draw: number; away: number } | null>(null);
  const deltas = useMemo(() => {
    if (!odds || !prevOddsRef.current) return { home: undefined, draw: undefined, away: undefined };
    const prev = prevOddsRef.current;
    return { home: odds.home - prev.home, draw: odds.draw - prev.draw, away: odds.away - prev.away };
  }, [odds]);
  useEffect(() => {
    if (odds) prevOddsRef.current = { home: odds.home, draw: odds.draw, away: odds.away };
  }, [odds]);

  const [selection, setSelection] = useState<{ outcome: Outcome; odds: number } | null>(null);
  const [betAmount, setBetAmount] = useState("25");

  const bettingDisabled = marketStatus !== "OPEN" || odds === null;

  const outcomes: { outcome: Outcome; label: string; odds: number; impliedPct: number; delta?: number }[] = [
    { outcome: 0, label: home, odds: odds?.home ?? 0, impliedPct: odds?.impliedPct[0] ?? 0, delta: deltas.home },
    { outcome: 1, label: "Draw", odds: odds?.draw ?? 0, impliedPct: odds?.impliedPct[1] ?? 0, delta: deltas.draw },
    { outcome: 2, label: away, odds: odds?.away ?? 0, impliedPct: odds?.impliedPct[2] ?? 0, delta: deltas.away },
  ];

  const betSlipSelection: BetSlipSelection | null =
    selection !== null
      ? { fixtureId, home, away, outcome: selection.outcome, odds: selection.odds }
      : null;

  const pools: [bigint, bigint, bigint] =
    market?.synced && market.pools
      ? [BigInt(market.pools[0]), BigInt(market.pools[1]), BigInt(market.pools[2])]
      : [0n, 0n, 0n];

  return (
    <div className="space-y-6">
      <MatchHeader
        home={home}
        away={away}
        stage={stage}
        group={group}
        kickoffTs={kickoffTs}
        marketStatus={marketStatus}
        isLive={isLive}
        liveScore={isLive ? { home: score?.home ?? 0, away: score?.away ?? 0, minute: score?.minute } : null}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Market
            </p>
            <div className="flex gap-2">
              {outcomes.map((o) => (
                <OddsDisplay
                  key={o.outcome}
                  label={o.label}
                  odds={o.odds}
                  impliedPct={o.impliedPct}
                  delta={o.delta}
                  selected={selection?.outcome === o.outcome}
                  disabled={bettingDisabled}
                  onSelect={() => setSelection({ outcome: o.outcome, odds: o.odds })}
                />
              ))}
            </div>
          </section>

          <OddsChart odds={odds} home={home} away={away} />

          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="verification">Verification</TabsTrigger>
            </TabsList>
            <TabsContent value="activity">
              <ActivityTab fixtureId={fixtureId} home={home} away={away} />
            </TabsContent>
            <TabsContent value="verification">
              <VerificationTab />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <PoolPanel home={home} away={away} market={market} loading={marketLoading} />
          <BetSlip
            selection={betSlipSelection}
            pools={pools}
            amount={betAmount}
            onAmountChange={setBetAmount}
            onSubmit={() => alert("Shell only — full place_bet wiring lands in Phase 5.")}
          />
        </aside>
      </div>
    </div>
  );
}

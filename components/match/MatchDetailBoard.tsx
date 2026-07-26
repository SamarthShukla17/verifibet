"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLiveFixture } from "@/lib/hooks/useLiveFixture";
import { useMarketAccount } from "@/lib/hooks/useMarketAccount";
import { usePlaceBet } from "@/lib/hooks/usePlaceBet";
import { fixtureStatusFromActionAndStatusId, isForwardStatusTransition } from "@/lib/txline/normalize";
import { isKnockoutStage, marketStatusFromFixtureStatus } from "@/lib/market";
import { MatchHeader } from "@/components/match/MatchHeader";
import { OddsDisplay } from "@/components/market/OddsDisplay";
import { InfoTooltip } from "@/components/InfoTooltip";
import { PoolPanel } from "@/components/match/PoolPanel";
import { ActivityTab } from "@/components/match/ActivityTab";
import { VerificationTab } from "@/components/match/VerificationTab";
import { BetSlip, type BetSlipSelection } from "@/components/bet/BetSlip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { FixtureStage, FixtureStatus, MarketStatus, Outcome, ScoreEvent } from "@/lib/types";

/** `ssr: false` + dynamic import: `recharts` (+ its `victory-vendor`/d3,
 * `@reduxjs/toolkit`, `decimal.js-light` transitive weight) is ~96KB
 * gzipped, the single heaviest dependency in this app — see NOTES.md's
 * bundle-analysis section. `OddsChart` takes only plain serializable
 * props, so deferring it costs nothing but a brief skeleton the first
 * time this panel scrolls into view. */
const OddsChart = dynamic(() => import("@/components/OddsChart").then((m) => m.OddsChart), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-xl" />,
});

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
  const {
    market,
    loading: marketLoading,
    refresh: refreshMarket,
    applyOptimisticBump,
  } = useMarketAccount(fixtureId);

  // Starts from the server-fetched status and upgrades live as real
  // status-stream events arrive — the same mapping the tracker itself
  // uses (lib/txline/normalize.ts), so a viewer watching this exact page
  // can see a SCHEDULED match actually go LIVE without a reload.
  //
  // `isForwardStatusTransition` guards this exactly like
  // `StatusTracker.transitionTo` does server-side — without it, a real,
  // ordinary mid-match event with no `StatusId` (`suspend`, `comment`,
  // `action_discarded`, ...) bounces this page's own header back to
  // "not started" even though the fixture is genuinely still live or
  // already finished. Confirmed the hard way narrating a demo replay
  // through a `suspend` event that landed right after a goal (Session
  // 7.3) — this bug predates that session, the demo replay just made it
  // easy to actually hit.
  const [liveStatus, setLiveStatus] = useState<FixtureStatus>(status);
  useEffect(() => {
    if (!live.status) return;
    const next = fixtureStatusFromActionAndStatusId(live.status.action, live.status.statusId);
    setLiveStatus((prev) => (isForwardStatusTransition(prev, next) ? next : prev));
  }, [live.status]);

  const isLive = liveStatus === "LIVE";
  const isFinished = liveStatus === "FINISHED";
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

  // Gating on market status alone, not `odds === null` too: CLAUDE.md's
  // TxLINE data-endpoints section is explicit that `[]` from
  // `/odds/snapshot` ("no recent odds activity") is a normal, real result,
  // not a failure — OddsDisplay already renders "no data"/"—" for
  // `odds <= 0` rather than a bogus "0.00x" (see its own doc comment).
  // Blocking betting on a genuinely OPEN market just because the last
  // 5-minute odds window happened to be empty would punish users for a
  // reference-price gap that the payout math doesn't even depend on
  // (estimatePayout is pools-only).
  const bettingDisabled = marketStatus !== "OPEN";

  // The KO market rule (see lib/market.ts#isKnockoutStage): every stage but
  // GROUP always produces a winner (extra time + penalties), so a
  // knockout fixture's market never has a Draw outcome to pick at all —
  // not just a disabled tile, it isn't offered.
  const allOutcomes: { outcome: Outcome; label: string; odds: number; impliedPct: number; delta?: number }[] = [
    { outcome: 0, label: home, odds: odds?.home ?? 0, impliedPct: odds?.impliedPct[0] ?? 0, delta: deltas.home },
    { outcome: 1, label: "Draw", odds: odds?.draw ?? 0, impliedPct: odds?.impliedPct[1] ?? 0, delta: deltas.draw },
    { outcome: 2, label: away, odds: odds?.away ?? 0, impliedPct: odds?.impliedPct[2] ?? 0, delta: deltas.away },
  ];
  const outcomes = isKnockoutStage(stage) ? allOutcomes.filter((o) => o.outcome !== 1) : allOutcomes;

  const betSlipSelection: BetSlipSelection | null =
    selection !== null
      ? { fixtureId, home, away, outcome: selection.outcome, odds: selection.odds }
      : null;

  const pools: [bigint, bigint, bigint] =
    market?.synced && market.pools
      ? [BigInt(market.pools[0]), BigInt(market.pools[1]), BigInt(market.pools[2])]
      : [0n, 0n, 0n];

  const { balance, balanceLoading, placeBet } = usePlaceBet(market, applyOptimisticBump, refreshMarket);

  async function handlePlaceBet(): Promise<string> {
    if (selection === null) throw new Error("no outcome selected");
    return placeBet(fixtureId, selection.outcome, betAmount);
  }

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
        isFinished={isFinished}
        liveScore={
          isLive || isFinished ? { home: score?.home ?? 0, away: score?.away ?? 0, minute: score?.minute } : null
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Market
              </p>
              {isKnockoutStage(stage) && (
                <>
                  <span className="text-[11px] text-muted-foreground">
                    Includes extra time &amp; penalties — no draw
                  </span>
                  <InfoTooltip text="Knockout matches always produce a winner. If the score is level after 90 minutes, extra time and then a penalty shootout decide who advances — this market has no Draw outcome." />
                </>
              )}
            </div>
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
              <VerificationTab fixtureId={fixtureId} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <PoolPanel home={home} away={away} market={market} loading={marketLoading} />
          <BetSlip
            selection={betSlipSelection}
            pools={pools}
            marketStatus={marketStatus}
            kickoffTs={kickoffTs}
            balance={balance}
            balanceLoading={balanceLoading}
            amount={betAmount}
            onAmountChange={setBetAmount}
            onSubmit={handlePlaceBet}
          />
        </aside>
      </div>
    </div>
  );
}

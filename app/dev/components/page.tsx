"use client";

import { useEffect, useState } from "react";
import { MarketStatusBadge } from "@/components/market/MarketStatusBadge";
import { OddsDisplay } from "@/components/market/OddsDisplay";
import { MatchCard } from "@/components/market/MatchCard";
import { BetSlip, type BetSlipSelection } from "@/components/bet/BetSlip";
import type { Fixture, MarketStatus, OddsSnapshot, Outcome } from "@/lib/types";

/**
 * Dev-only gallery — every state of the four core components against
 * mock data, for visual QA and the demo video's b-roll. Not linked from
 * anywhere in the real app; hit `/dev/components` directly.
 */

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5 space-y-1">
      <h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2>
      {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

// --- Mock data — real 2026 World Cup teams/fixtures so lib/flags.ts's
// mapping gets exercised for real, not with placeholder names. ---

/**
 * A fixed reference instant, not `Date.now()` — module-scope code runs
 * once on the server during SSR and again on the client during
 * hydration, at two different wall-clock moments; if a `Date.now()`-
 * derived value changed the *text* `formatKickoff` renders (e.g. the
 * two evaluations straddle a minute boundary, easy to hit under dev-mode
 * compile lag), React's hydration diff fails hard. A fixed instant is
 * identical on both passes by construction.
 */
const NOW_TS = Math.floor(new Date("2026-07-21T12:00:00Z").getTime() / 1000);

const FIXTURE_OPEN: Fixture = {
  fixtureId: 18257865,
  home: "France",
  away: "England",
  kickoffTs: NOW_TS + 3 * 86_400,
  stage: "THIRD",
  status: "SCHEDULED",
};

const FIXTURE_LIVE: Fixture = {
  fixtureId: 18175983,
  home: "Germany",
  away: "Paraguay",
  kickoffTs: NOW_TS - 5_000,
  stage: "R32",
  status: "LIVE",
};

const FIXTURE_RESOLVED: Fixture = {
  fixtureId: 18257739,
  home: "Spain",
  away: "Argentina",
  kickoffTs: NOW_TS - 86_400,
  stage: "FINAL",
  status: "FINISHED",
};

const FIXTURE_VOIDED: Fixture = {
  fixtureId: 18202701,
  home: "Argentina",
  away: "Egypt",
  kickoffTs: NOW_TS - 200_000,
  stage: "R16",
  status: "CANCELLED",
};

const ODDS_OPEN: OddsSnapshot = {
  fixtureId: FIXTURE_OPEN.fixtureId,
  home: 2.4,
  draw: 3.3,
  away: 2.85,
  impliedPct: [39.2, 28.5, 32.3],
  overroundPct: 3.1,
  ts: NOW_TS * 1000,
};

const ODDS_LIVE: OddsSnapshot = {
  fixtureId: FIXTURE_LIVE.fixtureId,
  home: 1.95,
  draw: 3.4,
  away: 4.18,
  impliedPct: [48.6, 27.9, 23.5],
  overroundPct: 4.0,
  ts: NOW_TS * 1000,
};

export default function DevComponentsPage() {
  const [oddsSelected, setOddsSelected] = useState(false);

  // Live-flash demo: nudges a mock odds value every 2.5s so the 600ms
  // flash animation is genuinely visible on this page, not just
  // theoretically wired up. `tickerDelta` is computed inside the same
  // setState updater that computes the new odds (not in a follow-up
  // effect reacting to the change) — doing it as a separate effect would
  // set the delta one render late, then immediately overwrite it back to
  // 0 on the very next render it triggers, so the non-zero delta would
  // never actually be visible.
  const [tickerOdds, setTickerOdds] = useState(1.953);
  const [tickerDelta, setTickerDelta] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTickerOdds((prev) => {
        const next = Math.max(1.1, Math.round((prev + (Math.random() - 0.5) * 0.12) * 1000) / 1000);
        setTickerDelta(Math.round((next - prev) * 1000) / 1000);
        return next;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const [matchSelection, setMatchSelection] = useState<{
    fixtureId: number;
    outcome: Outcome;
  } | null>(null);

  const [betAmount, setBetAmount] = useState("25");

  const pools: [bigint, bigint, bigint] = [4_200_000_000n, 3_100_000_000n, 5_150_000_000n];

  const betSlipSelection: BetSlipSelection | null =
    matchSelection && matchSelection.fixtureId === FIXTURE_OPEN.fixtureId
      ? {
          fixtureId: FIXTURE_OPEN.fixtureId,
          home: FIXTURE_OPEN.home,
          away: FIXTURE_OPEN.away,
          outcome: matchSelection.outcome,
          odds: [ODDS_OPEN.home, ODDS_OPEN.draw, ODDS_OPEN.away][matchSelection.outcome],
        }
      : null;

  return (
    <div className="min-h-screen bg-background pb-40 lg:pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-primary">
            DEV ONLY
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold text-foreground">
            Component gallery
          </h1>
          <p className="mt-2 text-muted-foreground">
            Every state of the four core components, against mock data.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8 lg:flex lg:items-start lg:gap-8">
        <main className="min-w-0 flex-1 space-y-16">
          {/* MarketStatusBadge */}
          <section>
            <SectionHeading
              title="MarketStatusBadge"
              description="OPEN emerald outline · LIVE pulsing ruby dot + minute · LOCKED muted · RESOLVED gold check · VOIDED gray strikethrough."
            />
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-6">
              <MarketStatusBadge status="OPEN" />
              <MarketStatusBadge status="LOCKED" isLive liveMinute={67} />
              <MarketStatusBadge status="LOCKED" />
              <MarketStatusBadge status="RESOLVED" />
              <MarketStatusBadge status="VOIDED" />
            </div>
          </section>

          {/* OddsDisplay */}
          <section>
            <SectionHeading
              title="OddsDisplay"
              description="Big tabular odds, implied % below, emerald fill when selected, 600ms flash on odds change."
            />
            <div className="space-y-4 rounded-lg border border-border bg-card p-6">
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <OddsDisplay
                  label="Home"
                  odds={1.953}
                  impliedPct={48.6}
                  selected={oddsSelected}
                  onSelect={() => setOddsSelected((s) => !s)}
                />
                <OddsDisplay label="Draw" odds={3.4} impliedPct={27.9} selected={false} onSelect={() => {}} />
                <OddsDisplay
                  label="Away"
                  odds={4.18}
                  impliedPct={23.5}
                  delta={-0.12}
                  selected={false}
                  onSelect={() => {}}
                />
                <OddsDisplay label="Disabled" odds={2.1} impliedPct={45.0} selected={false} onSelect={() => {}} disabled />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Live flash demo — updates every ~2.5s
                </p>
                <div className="max-w-[200px]">
                  <OddsDisplay
                    label="Live ticker"
                    odds={tickerOdds}
                    impliedPct={100 / tickerOdds}
                    delta={tickerDelta}
                    selected={false}
                    onSelect={() => {}}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* MatchCard */}
          <section>
            <SectionHeading
              title="MatchCard"
              description="Flags, kickoff in viewer tz, stage chip, three OddsDisplay, status badge, pool footer. Click an outcome below to populate the Bet Slip."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MatchCard
                fixture={FIXTURE_OPEN}
                odds={ODDS_OPEN}
                marketStatus="OPEN"
                totalPoolBaseUnits={pools[0] + pools[1] + pools[2]}
                selectedOutcome={
                  matchSelection?.fixtureId === FIXTURE_OPEN.fixtureId
                    ? matchSelection.outcome
                    : null
                }
                onSelectOutcome={(outcome) =>
                  setMatchSelection({ fixtureId: FIXTURE_OPEN.fixtureId, outcome })
                }
              />
              <MatchCard
                fixture={FIXTURE_LIVE}
                odds={ODDS_LIVE}
                marketStatus="LOCKED"
                live={{ minute: 67 }}
                totalPoolBaseUnits={12_450_000_000n}
              />
              <MatchCard
                fixture={FIXTURE_RESOLVED}
                odds={null}
                marketStatus="RESOLVED"
                totalPoolBaseUnits={9_875_500_000n}
              />
              <MatchCard
                fixture={FIXTURE_VOIDED}
                odds={null}
                marketStatus="VOIDED"
                totalPoolBaseUnits={0n}
              />
            </div>
          </section>
        </main>

        {/* BetSlip — fixed bottom-sheet under lg, sticky right rail at lg+ */}
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
    </div>
  );
}

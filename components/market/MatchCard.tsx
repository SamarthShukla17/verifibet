"use client";

import Link from "next/link";
import { flagUrl } from "@/lib/flags";
import { formatUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarketStatusBadge } from "@/components/market/MarketStatusBadge";
import { OddsDisplay } from "@/components/market/OddsDisplay";
import { STAGE_LABELS } from "@/lib/market";
import type { Fixture, MarketStatus, OddsSnapshot, Outcome } from "@/lib/types";

function formatKickoff(kickoffTs: number): string {
  // No explicit `timeZone` — Intl defaults to the runtime's own, which in
  // a 'use client' component is the viewer's actual local timezone, not
  // whatever the server happens to run in.
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(kickoffTs * 1000));
}

export interface MatchCardProps {
  fixture: Fixture;
  /** `null` when TxLINE has no current odds snapshot for this fixture
   * (a real, normal state — see lib/txline/client.ts's getOdds doc
   * comment) — renders the three selectors disabled with placeholders
   * instead of fabricating numbers. */
  odds: OddsSnapshot | null;
  marketStatus: MarketStatus;
  /** See MarketStatusBadge's own `isLive`/`liveMinute` — same meaning,
   * just bundled here as one optional object. */
  live?: { minute?: number } | null;
  /** USDC base units, 6dp — total across all three outcomes. */
  totalPoolBaseUnits: bigint;
  selectedOutcome?: Outcome | null;
  /** `odds` is whatever this card is currently showing for that outcome
   * (0 for the "no data" placeholder) — passed along so a caller that has
   * no other way to know the live-streamed odds value (see
   * `LiveMatchCard`) can still capture it at the moment of selection. */
  onSelectOutcome?: (outcome: Outcome, odds: number) => void;
  className?: string;
}

export function MatchCard({
  fixture,
  odds,
  marketStatus,
  live,
  totalPoolBaseUnits,
  selectedOutcome,
  onSelectOutcome,
  className,
}: MatchCardProps) {
  const bettingDisabled = marketStatus !== "OPEN";
  const homeFlag = flagUrl(fixture.home);
  const awayFlag = flagUrl(fixture.away);

  const outcomes: { outcome: Outcome; label: string; odds: number; impliedPct: number }[] = [
    { outcome: 0, label: fixture.home, odds: odds?.home ?? 0, impliedPct: odds?.impliedPct[0] ?? 0 },
    { outcome: 1, label: "Draw", odds: odds?.draw ?? 0, impliedPct: odds?.impliedPct[1] ?? 0 },
    { outcome: 2, label: fixture.away, odds: odds?.away ?? 0, impliedPct: odds?.impliedPct[2] ?? 0 },
  ];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
        className,
      )}
    >
      {/* Stretched link — the whole card navigates, except the odds
          selectors below, which sit in normal document flow above this
          absolutely-positioned overlay and so receive the click first. */}
      <Link
        href={`/matches/${fixture.fixtureId}`}
        className="absolute inset-0 z-0"
        aria-label={`${fixture.home} vs ${fixture.away}`}
      >
        <span className="sr-only">
          View {fixture.home} vs {fixture.away}
        </span>
      </Link>

      <div className="relative z-10 flex flex-col gap-3">
        {/* Stage / group + status */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
              {STAGE_LABELS[fixture.stage]}
            </span>
            {fixture.group && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                {fixture.group}
              </span>
            )}
          </div>
          <MarketStatusBadge
            status={marketStatus}
            isLive={Boolean(live)}
            liveMinute={live?.minute}
          />
        </div>

        {/* Teams */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {homeFlag && (
              <img
                src={homeFlag}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 shrink-0 rounded-full"
              />
            )}
            <span className="truncate font-display text-base font-semibold text-foreground sm:text-lg">
              {fixture.home}
            </span>
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">vs</span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
            <span className="truncate font-display text-base font-semibold text-foreground sm:text-lg">
              {fixture.away}
            </span>
            {awayFlag && (
              <img
                src={awayFlag}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 shrink-0 rounded-full"
              />
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{formatKickoff(fixture.kickoffTs)}</p>

        {/* Odds */}
        <div className="flex gap-2">
          {outcomes.map((o) => (
            <OddsDisplay
              key={o.outcome}
              label={o.label}
              odds={o.odds}
              impliedPct={o.impliedPct}
              selected={selectedOutcome === o.outcome}
              disabled={bettingDisabled || odds === null}
              onSelect={() => onSelectOutcome?.(o.outcome, o.odds)}
            />
          ))}
        </div>

        {/* Pool footer */}
        <div className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <span aria-hidden>💰</span>
          <span className="tabular font-medium text-foreground">
            {formatUsdc(totalPoolBaseUnits, 0)}
          </span>
          <span>USDC pooled</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OddsSnapshot } from "@/lib/types";

const MAX_POINTS = 30;

interface ChartPoint {
  ts: number;
  home: number;
  draw: number;
  away: number;
}

interface TooltipPayloadEntry {
  dataKey: "home" | "draw" | "away";
  value: number;
  stroke: string;
}

/**
 * recharts' own `content` prop types for a custom Tooltip are a generic,
 * hard-to-pin-down union (`value` can be `number | string | Array<...>`,
 * `payload` is optional, etc.) — narrowed to exactly the shape this chart
 * actually produces (`ChartPoint`'s three numeric series) right at this
 * one boundary rather than fighting recharts' generics throughout.
 */
function ChartTooltip(props: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: number;
  home: string;
  away: string;
}) {
  const { active, payload, label, home, away } = props;
  if (!active || !payload?.length) return null;

  const names: Record<TooltipPayloadEntry["dataKey"], string> = { home, draw: "Draw", away };

  return (
    <div className="glass rounded-lg p-2.5 text-xs shadow-lg">
      {label !== undefined && (
        <p className="tabular mb-1.5 text-muted-foreground">
          {new Date(label).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.stroke }}
                aria-hidden
              />
              <span className="text-muted-foreground">{names[entry.dataKey]}</span>
            </span>
            <span className="tabular font-semibold text-foreground">{entry.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface OddsChartProps {
  /** The latest odds snapshot — pushed into this chart's own bounded
   * ring buffer (last `MAX_POINTS`) as it changes over time. Passed as a
   * prop rather than this component calling `useLiveFixture` itself so a
   * page showing both this chart and the OddsDisplay tiles shares one
   * live subscription instead of opening two for the same fixture. */
  odds: OddsSnapshot | null;
  home: string;
  away: string;
}

/** Implied probability of each outcome over time, stacked to 100% — a
 * ring buffer of however many live snapshots have arrived so far (capped
 * at `MAX_POINTS`), fed entirely by the `odds` prop changing upstream. */
export function OddsChart({ odds, home, away }: OddsChartProps) {
  const [history, setHistory] = useState<ChartPoint[]>([]);
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);

  useEffect(() => {
    if (!odds) return;
    setHistory((prev) => {
      // The same snapshot re-rendering (e.g. a parent re-render for an
      // unrelated reason) shouldn't duplicate a point.
      if (prev.length > 0 && prev[prev.length - 1].ts === odds.ts) return prev;
      const next = [...prev, { ts: odds.ts, home: odds.impliedPct[0], draw: odds.impliedPct[1], away: odds.impliedPct[2] }];
      return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    });
  }, [odds]);

  useEffect(() => {
    if (!odds) return;
    const tick = () => setSecondsAgo(Math.max(0, Math.floor((Date.now() - odds.ts) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [odds]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Implied Probability
      </p>

      {history.length === 0 ? (
        <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
          Waiting for the first odds tick…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={176}>
          <AreaChart data={history} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="oddsChartHome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
              </linearGradient>
              <linearGradient id="oddsChartDraw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.5} />
                <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="oddsChartAway" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.7} />
                <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0.15} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={(ts: number) =>
                new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
              }
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own content-prop generics; narrowed inside ChartTooltip itself.
              content={(props: any) => <ChartTooltip {...props} home={home} away={away} />}
            />
            <Area type="monotone" dataKey="home" stackId="1" stroke="hsl(var(--primary))" fill="url(#oddsChartHome)" name={home} isAnimationActive={false} />
            <Area type="monotone" dataKey="draw" stackId="1" stroke="hsl(var(--muted-foreground))" fill="url(#oddsChartDraw)" name="Draw" isAnimationActive={false} />
            <Area type="monotone" dataKey="away" stackId="1" stroke="hsl(var(--destructive))" fill="url(#oddsChartAway)" name={away} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        <span className="tabular">
          TxLINE feed · updated {secondsAgo !== null ? `${secondsAgo}s ago` : "—"}
        </span>
      </div>
    </div>
  );
}

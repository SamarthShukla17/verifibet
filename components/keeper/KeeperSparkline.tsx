"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { SparklineBucket } from "@/app/api/keeper/logs/route";

interface TooltipPayloadEntry {
  dataKey: "success" | "failure";
  value: number;
}

function SparklineTooltip(props: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: number }) {
  const { active, payload, label } = props;
  if (!active || !payload?.length || label === undefined) return null;

  const success = payload.find((p) => p.dataKey === "success")?.value ?? 0;
  const failure = payload.find((p) => p.dataKey === "failure")?.value ?? 0;

  return (
    <div className="glass rounded-lg p-2.5 text-xs shadow-lg">
      <p className="tabular mb-1 text-muted-foreground">
        {new Date(label).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
      </p>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
            Success
          </span>
          <span className="tabular font-semibold text-foreground">{success}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden />
            Failure
          </span>
          <span className="tabular font-semibold text-foreground">{failure}</span>
        </div>
      </div>
    </div>
  );
}

/** Stacked success/failure job-attempt counts, 30-minute buckets across
 * the last 24h (`app/api/keeper/logs/route.ts` computes the buckets
 * server-side — this only renders them). A quiet keeper genuinely shows
 * mostly-empty bars with a cluster near "now" — that's the honest shape
 * of a fresh operator's real history, not a rendering bug. */
export function KeeperSparkline({ buckets }: { buckets: SparklineBucket[] }) {
  const hasActivity = buckets.some((b) => b.success > 0 || b.failure > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Job Outcomes · Last 24h
        </p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Success
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden /> Failure
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={0} barCategoryGap={1}>
          <XAxis
            dataKey="bucketStart"
            tickFormatter={(ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric" })}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))" }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' own content-prop generics; narrowed inside SparklineTooltip.
            content={(props: any) => <SparklineTooltip {...props} />}
          />
          <Bar dataKey="success" stackId="outcome" fill="hsl(var(--primary))" isAnimationActive={false} radius={[1, 1, 0, 0]} />
          <Bar dataKey="failure" stackId="outcome" fill="hsl(var(--destructive))" isAnimationActive={false} radius={[1, 1, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {!hasActivity && (
        <p className="mt-2 text-center text-xs text-muted-foreground">No job activity in the last 24h yet.</p>
      )}
    </div>
  );
}

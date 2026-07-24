import { ExternalLink } from "lucide-react";
import { explorerTxUrl } from "@/lib/explorer";
import { formatUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Receipt } from "@/lib/types";
import type { MarketTimeline } from "@/lib/solana/timeline";

function formatDateTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(unixSeconds * 1000),
  );
}

function Step({
  title,
  timestamp,
  isLast,
  children,
}: {
  title: string;
  timestamp?: string;
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {!isLast && <span className="w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn("min-w-0", isLast ? "pb-0" : "pb-6")}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {timestamp && <p className="tabular text-xs text-muted-foreground">{timestamp}</p>}
        </div>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export interface ReceiptTimelineProps {
  receipt: Receipt;
  timeline: MarketTimeline;
}

/**
 * Market created -> bets placed -> kickoff -> full time -> resolved ->
 * claims. Two rows (bets, claims) lean on `receipt.pools`/`totalPool`
 * (durable — frozen on the account itself at `resolve_market`, readable
 * forever) rather than only the signature-history scan
 * (`lib/solana/timeline.ts`), which — confirmed directly, not assumed —
 * can genuinely lose older signatures to the public devnet RPC's
 * retention window well before an account itself is pruned. A market
 * whose `totalPool` is real and positive but whose bet-count scan came
 * back empty is "bets definitely happened, exact count/timing no longer
 * recoverable", not "zero bets" — the copy below says exactly that
 * instead of quietly rendering a wrong number.
 */
export function ReceiptTimeline({ receipt, timeline }: ReceiptTimelineProps) {
  const totalPool = BigInt(receipt.totalPool);
  const historyPruned = timeline.createdAt === null && timeline.betCount === 0 && totalPool > 0n;

  const betTitle =
    totalPool === 0n
      ? "No bets placed"
      : timeline.betCount > 0
        ? `${timeline.betCount} bet${timeline.betCount === 1 ? "" : "s"} placed`
        : "Bets placed";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Settlement timeline
      </p>

      <Step title="Market created" timestamp={timeline.createdAt ? formatDateTime(timeline.createdAt) : undefined}>
        {timeline.createdTxSig ? (
          <a
            href={explorerTxUrl(timeline.createdTxSig)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            View transaction <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : (
          <span className="italic">Outside the public RPC&apos;s retention window</span>
        )}
      </Step>

      <Step title={betTitle}>
        {totalPool > 0n && (
          <span>
            {formatUsdc(totalPool)} USDC total
            {timeline.firstBetAt && timeline.lastBetAt && (
              <>
                {" "}
                · {formatDateTime(timeline.firstBetAt)}
                {timeline.firstBetAt !== timeline.lastBetAt ? ` – ${formatDateTime(timeline.lastBetAt)}` : ""}
              </>
            )}
          </span>
        )}
      </Step>

      <Step title="Kickoff" timestamp={formatDateTime(receipt.kickoffTs)} />

      <Step title="Full time" />

      <Step title="Resolved" timestamp={formatDateTime(receipt.resolvedAt)}>
        <a
          href={receipt.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          View transaction <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </Step>

      <Step
        title={timeline.claimCount > 0 ? `${timeline.claimCount} claim${timeline.claimCount === 1 ? "" : "s"}` : "No claims yet"}
        isLast
      />

      {historyPruned && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          Some early on-chain history (market creation, initial bets) can fall outside the public
          devnet RPC&apos;s retention window over time — this never affects the settlement proof
          above, which is independently verifiable regardless.
        </p>
      )}
    </div>
  );
}

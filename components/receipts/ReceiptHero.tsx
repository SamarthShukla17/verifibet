import { flagUrl } from "@/lib/flags";
import type { Receipt } from "@/lib/types";

function outcomeWinner(receipt: Receipt): string {
  return receipt.outcome === 1 ? "Draw" : receipt.outcome === 0 ? receipt.teams.home : receipt.teams.away;
}

function TeamMini({ name }: { name: string }) {
  const flag = flagUrl(name);
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      {flag && <img src={flag} alt="" className="h-12 w-12 shrink-0 rounded-full sm:h-16 sm:w-16" />}
      <span className="max-w-[9rem] truncate font-display text-lg font-bold text-foreground sm:max-w-none sm:text-2xl">
        {name}
      </span>
    </div>
  );
}

export interface ReceiptHeroProps {
  receipt: Receipt;
  /** Best-effort — `Market` itself has no `stage` field, only TxLINE's
   * fixture metadata does; `null` (a synthetic test fixture, or TxLINE
   * simply unreachable) just omits the label. */
  stage?: string | null;
}

/** Teams/score/outcome — the receipt page's own hero, standalone (no
 * live-match/kickoff-countdown logic like `MatchHeader.tsx`, since a
 * receipt only ever exists for an already-resolved market). */
export function ReceiptHero({ receipt, stage }: ReceiptHeroProps) {
  const winner = outcomeWinner(receipt);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center sm:p-8">
      {stage && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage}</p>
      )}
      <div className="flex items-center justify-center gap-4 sm:gap-8">
        <TeamMini name={receipt.teams.home} />
        <span className="tabular shrink-0 font-display text-4xl font-bold text-foreground sm:text-6xl">
          {receipt.finalScore.home}
          <span className="mx-2 text-muted-foreground">–</span>
          {receipt.finalScore.away}
        </span>
        <TeamMini name={receipt.teams.away} />
      </div>
      <div className="mt-5 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {receipt.outcome === 1 ? "Match drawn" : `${winner} won`}
        </span>
      </div>
    </div>
  );
}

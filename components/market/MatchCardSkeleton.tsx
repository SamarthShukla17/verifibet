import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder shaped like `MatchCard` — same padding, border, and
 * section structure (stage/status row, team row, kickoff line, three odds
 * boxes, pool footer) so the page doesn't visibly reflow once real cards
 * swap in.
 */
export function MatchCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3">
        {/* Stage / group + status */}
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>

        {/* Teams */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-3 w-4 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          </div>
        </div>

        <Skeleton className="h-3 w-32" />

        {/* Odds */}
        <div className="flex gap-2">
          <Skeleton className="h-[4.5rem] flex-1 rounded-lg" />
          <Skeleton className="h-[4.5rem] flex-1 rounded-lg" />
          <Skeleton className="h-[4.5rem] flex-1 rounded-lg" />
        </div>

        {/* Pool footer */}
        <div className="flex items-center gap-1.5 border-t border-border pt-3">
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { MatchCardSkeleton } from "@/components/market/MatchCardSkeleton";

/**
 * Next's Suspense fallback for this route segment while `page.tsx`'s
 * fetch is in flight — on first load and on every filter change (each
 * one re-renders the Server Component against the new `searchParams`).
 * Navbar/FilterRail/Footer stay mounted throughout (they live in
 * app/matches/(list)/layout.tsx, outside this boundary); only the match list +
 * bet slip shown here.
 */
export default function MatchesLoading() {
  return (
    <>
      <main className="min-w-0 flex-1 pb-24 lg:pb-0">
        <div className="mb-4 mt-4 lg:mt-0">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <MatchCardSkeleton key={i} />
          ))}
        </div>
      </main>

      <aside className="lg:w-80 lg:shrink-0">
        <div className="glass rounded-2xl p-5">
          <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bet Slip
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Select an outcome on any match to build a bet.
          </p>
        </div>
      </aside>
    </>
  );
}

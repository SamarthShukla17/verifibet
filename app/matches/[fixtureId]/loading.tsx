import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Skeleton } from "@/components/ui/skeleton";

/** Same shape as the real page (header card, market tiles, odds chart,
 * tabs, bet slip aside) so nothing visibly jumps once real data lands —
 * this route has no `layout.tsx` of its own, so `Navbar`/`Footer` are
 * re-rendered here rather than inherited. */
export default function MatchLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
            <div className="min-w-0 space-y-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
              <Skeleton className="h-72 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>

            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      </div>

      <Footer />
      <div aria-hidden className="h-[26rem] lg:hidden" />
    </div>
  );
}

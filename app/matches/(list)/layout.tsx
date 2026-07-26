import { Suspense } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { FilterRailUrlSync } from "@/components/market/FilterRailUrlSync";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches `FilterRail`'s own `hidden lg:block lg:w-60` root so the
 * fallback claims the same layout space — no shift when the real
 * `useSearchParams()`-backed rail mounts. */
function FilterRailFallback() {
  return (
    <aside className="hidden lg:block lg:w-60 lg:shrink-0">
      <Skeleton className="h-96 w-full rounded-xl" />
    </aside>
  );
}

/**
 * Navbar, filter rail, and footer live here rather than in page.tsx so
 * they stay mounted (stable, non-flashing) across the Suspense boundary
 * `app/matches/(list)/loading.tsx` creates around page.tsx's async data fetch —
 * only the match list + bet slip inside `{children}` show a skeleton
 * while fixtures load; the chrome around them never does.
 */
export default function MatchesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:flex lg:items-start lg:gap-8">
        <Suspense fallback={<FilterRailFallback />}>
          <FilterRailUrlSync />
        </Suspense>
        {children}
      </div>

      <Footer />

      {/*
       * BetSlip is `fixed inset-x-0 bottom-0` below `lg` (see its own
       * lg:sticky override inside components/bet/BetSlip.tsx), so it
       * overlaps whatever is at the bottom of the viewport regardless of
       * scroll position — including this footer, which ends exactly at
       * the document's end, coincident with the fixed sheet. This
       * trailing spacer buys back the scroll room needed for the
       * footer's real content to clear the sheet before scrolling
       * bottoms out. Sized for BetSlip's larger (selection-made) state
       * (~363px measured, see app/matches's previous session) rather
       * than switching with selection state — that state lives inside
       * `{children}` (components/market/MatchesBoard.tsx), a client
       * boundary this server layout doesn't reach into, so a fixed
       * conservative height is simpler than threading it through.
       */}
      <div aria-hidden className="h-[26rem] lg:hidden" />
    </div>
  );
}

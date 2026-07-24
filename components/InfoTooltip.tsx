/**
 * A small info glyph that reveals an explanatory tooltip on hover/focus —
 * extracted from `BetSlip.tsx` (its original, sole call site) once
 * `MatchDetailBoard.tsx`'s knockout-market caption needed the identical
 * thing, rather than a second copy that could drift from this one.
 */
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <span tabIndex={0} className={cn("group/tip relative inline-flex outline-none", className)}>
      <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="sr-only">{text}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-center text-[11px] leading-snug text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

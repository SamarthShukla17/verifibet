import { cn } from "@/lib/utils";

export interface StreakChipProps {
  streak: number;
  className?: string;
}

/**
 * "🔥 W{n}" — a wallet's current consecutive-win streak
 * (`lib/parimutuel.ts`'s `computeStreak`, surfaced via
 * `lib/portfolio.ts`'s `PortfolioStats.streak` on the Portfolio page and
 * `app/api/leaderboard/route.ts`'s equivalent per-wallet aggregation on
 * the leaderboard) — the one place this chip's markup exists, shared by
 * both rather than each page styling its own.
 *
 * Renders nothing for `streak <= 0` — there's no "🔥 W0" to show, and a
 * wallet whose most recently decided bet was a loss isn't "on a streak"
 * just because that's technically representable as zero.
 */
export function StreakChip({ streak, className }: StreakChipProps) {
  if (streak <= 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-accent-gold/40 bg-accent-gold/10 px-2 py-0.5 text-xs font-semibold text-accent-gold",
        className,
      )}
    >
      🔥 W{streak}
    </span>
  );
}

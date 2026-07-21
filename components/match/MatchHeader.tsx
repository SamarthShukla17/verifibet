import { flagUrl } from "@/lib/flags";
import { STAGE_LABELS } from "@/lib/market";
import { cn } from "@/lib/utils";
import { MarketStatusBadge } from "@/components/market/MarketStatusBadge";
import type { FixtureStage, MarketStatus } from "@/lib/types";

function formatKickoff(kickoffTs: number): string {
  // No explicit `timeZone` — viewer-local, same convention as MatchCard's
  // own `formatKickoff`.
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(kickoffTs * 1000));
}

function TeamLockup({ name, align }: { name: string; align: "left" | "right" }) {
  const flag = flagUrl(name);
  return (
    <div
      className={cn(
        // Full-width, centered row on mobile (so a long name gets the
        // whole card's width instead of squeezing into a third of a
        // cramped 3-across flex row and truncating) — reverts to the
        // tight left/right lockup once there's room at sm+.
        "flex min-w-0 items-center justify-center gap-3 sm:flex-1",
        align === "right" ? "sm:flex-row-reverse sm:text-right" : "sm:justify-start",
      )}
    >
      {flag && (
        <img
          src={flag}
          alt=""
          width={56}
          height={56}
          className="h-10 w-10 shrink-0 rounded-full sm:h-14 sm:w-14"
        />
      )}
      <span className="truncate font-display text-2xl font-bold text-foreground sm:text-4xl">
        {name}
      </span>
    </div>
  );
}

export interface MatchHeaderProps {
  home: string;
  away: string;
  stage: FixtureStage;
  group?: string;
  kickoffTs: number;
  marketStatus: MarketStatus;
  isLive: boolean;
  /** Present only once `isLive` — a live score with no minute yet (the
   * very first tick after kickoff) is a real, normal transient state. */
  liveScore?: { home: number; away: number; minute?: number } | null;
}

/**
 * The page's hero — big team-vs-team lockup, stage/kickoff, status badge.
 * LIVE swaps the kickoff-time line for a display-type score + minute and
 * wraps the whole card in a slowly-rotating gradient ring (`.live-
 * gradient-border`, see app/globals.css) — the one place on the page that
 * visually says "this is happening right now" at a glance, before a
 * viewer reads a single word.
 */
export function MatchHeader({
  home,
  away,
  stage,
  group,
  kickoffTs,
  marketStatus,
  isLive,
  liveScore,
}: MatchHeaderProps) {
  return (
    <div className={cn("rounded-2xl", isLive && "live-gradient-border")}>
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
              {STAGE_LABELS[stage]}
            </span>
            {group && (
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                Group {group}
              </span>
            )}
          </div>
          <MarketStatusBadge status={marketStatus} isLive={isLive} liveMinute={liveScore?.minute} />
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <TeamLockup name={home} align="left" />

          <div className="flex shrink-0 flex-col items-center gap-1">
            {isLive && liveScore ? (
              <span className="tabular font-display text-4xl font-bold text-foreground sm:text-6xl">
                {liveScore.home}
                <span className="mx-2 text-muted-foreground">–</span>
                {liveScore.away}
              </span>
            ) : (
              <span className="font-display text-lg font-medium text-muted-foreground sm:text-2xl">
                vs
              </span>
            )}
          </div>

          <TeamLockup name={away} align="right" />
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {isLive ? "Live now" : formatKickoff(kickoffTs)}
        </p>
      </div>
    </div>
  );
}

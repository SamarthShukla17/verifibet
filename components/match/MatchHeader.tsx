"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

/**
 * One score number (home or away), flipping like an odometer digit
 * whenever `value` changes — old value rotates out top-to-back while the
 * new one rotates in from the same axis, via `AnimatePresence` keyed on
 * `value` itself (mirroring `OddsDisplay.tsx`'s `key={odds}` flash
 * trigger: a value-keyed remount is what actually restarts the
 * animation cleanly, not manual bookkeeping). `reduceMotion` swaps this
 * for a plain, instant number with no wrapper at all.
 */
function ScoreDigit({ value, reduceMotion }: { value: number; reduceMotion: boolean }) {
  if (reduceMotion) return <span>{value}</span>;

  return (
    <span className="relative inline-block" style={{ perspective: 400 }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ rotateX: 90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={{ rotateX: -90, opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeInOut" }}
          className="inline-block"
          style={{ transformStyle: "preserve-3d" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * One-shot diagonal light sweep across the whole card — triggered
 * exactly once per goal (see `MatchHeader`'s own effect below), not a
 * looping/idle shimmer. Removes itself from the DOM via
 * `onAnimationComplete` rather than lingering as an invisible layer.
 */
function GoalShimmer({ onComplete }: { onComplete: () => void }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        initial={{ x: "-120%" }}
        animate={{ x: "220%" }}
        transition={{ duration: 0.7, ease: "easeInOut" }}
        onAnimationComplete={onComplete}
      />
    </motion.div>
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
  /** `true` once the fixture has finished — swaps the caption from "Live
   * now"/kickoff time to "Full-time" and keeps `score` on screen instead
   * of reverting to "vs" (a real bug found live in Session 7's demo
   * rehearsal: jumping the replay to Full-time flipped `isLive` false
   * before this existed, so the hero briefly showed "vs" again right at
   * the one moment a viewer most wants to see the final score). */
  isFinished?: boolean;
  /** Present once `isLive` or `isFinished` — a live score with no minute
   * yet (the very first tick after kickoff) is a real, normal transient
   * state. */
  liveScore?: { home: number; away: number; minute?: number } | null;
}

/**
 * The page's hero — big team-vs-team lockup, stage/kickoff, status badge.
 * LIVE swaps the kickoff-time line for a display-type score + minute and
 * wraps the whole card in a slowly-rotating gradient ring (`.live-
 * gradient-border`, see app/globals.css) — the one place on the page that
 * visually says "this is happening right now" at a glance, before a
 * viewer reads a single word.
 *
 * A goal (either score digit changing while `isLive`) fires two more
 * motion cues on top of that: `ScoreDigit`'s per-number flip (always, so
 * it still reads correctly at Full-time) and `GoalShimmer`'s one-shot
 * light sweep (gated to `isLive` specifically — a goal is the trigger,
 * not any score present at all, so the initial live score never fires a
 * shimmer for a "0-0 kickoff" it never actually saw change).
 */
export function MatchHeader({
  home,
  away,
  stage,
  group,
  kickoffTs,
  marketStatus,
  isLive,
  isFinished,
  liveScore,
}: MatchHeaderProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const prevScore = useRef<{ home: number; away: number } | null>(null);
  const [shimmerKey, setShimmerKey] = useState(0);

  useEffect(() => {
    if (!liveScore) return;
    const prev = prevScore.current;
    prevScore.current = { home: liveScore.home, away: liveScore.away };
    if (!prev) return; // first sighting of a live score isn't a goal
    if (isLive && !reduceMotion && (liveScore.home !== prev.home || liveScore.away !== prev.away)) {
      setShimmerKey((k) => k + 1);
    }
  }, [liveScore, isLive, reduceMotion]);

  return (
    <div className={cn("relative rounded-2xl", isLive && "live-gradient-border")}>
      <AnimatePresence>
        {shimmerKey > 0 && (
          <GoalShimmer key={shimmerKey} onComplete={() => setShimmerKey(0)} />
        )}
      </AnimatePresence>
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
            {(isLive || isFinished) && liveScore ? (
              <span className="tabular font-display text-4xl font-bold text-foreground sm:text-6xl">
                <ScoreDigit value={liveScore.home} reduceMotion={reduceMotion} />
                <span className="mx-2 text-muted-foreground">–</span>
                <ScoreDigit value={liveScore.away} reduceMotion={reduceMotion} />
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
          {isLive ? "Live now" : isFinished ? "Full-time" : formatKickoff(kickoffTs)}
        </p>
      </div>
    </div>
  );
}

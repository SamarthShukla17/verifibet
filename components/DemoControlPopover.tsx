"use client";

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DemoChapter } from "@/lib/txline/demoScenarios";

export interface DemoControlPopoverProps {
  chapters: DemoChapter[];
  speed: number;
  paused: boolean;
  onSpeedChange: (value: number) => void;
  onJumpToChapter: (index: number) => void;
  onTogglePause: () => void;
  className?: string;
}

const MIN_SPEED = 1;
const MAX_SPEED = 240;

/**
 * The panel `components/DemoReplayBanner.tsx`'s pill opens — speed
 * slider, chapter jump buttons (from the active scenario's hand-written
 * `.chapters.json`), and pause/play. Purely a controlled view: every
 * value shown and every action taken flows through props, so the
 * keyboard shortcut (⌘/Ctrl+→, wired in the banner so it works whether
 * or not this popover is even open) and this panel's own buttons can
 * never disagree about what state the replay is actually in.
 */
export function DemoControlPopover({
  chapters,
  speed,
  paused,
  onSpeedChange,
  onJumpToChapter,
  onTogglePause,
  className,
}: DemoControlPopoverProps) {
  return (
    <div
      className={cn(
        "w-72 rounded-xl border border-accent-gold/30 bg-popover p-4 text-popover-foreground shadow-xl",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Speed</p>
        <span className="tabular text-sm font-bold text-accent-gold">{speed}×</span>
      </div>
      <input
        type="range"
        min={MIN_SPEED}
        max={MAX_SPEED}
        step={1}
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-accent-gold"
        aria-label="Replay speed"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{MIN_SPEED}×</span>
        <span>{MAX_SPEED}×</span>
      </div>

      {chapters.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Jump to
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chapters.map((chapter, i) => (
              <Button
                key={chapter.label}
                type="button"
                variant="outline"
                size="sm"
                className="border-accent-gold/30 hover:border-accent-gold/60 hover:bg-accent-gold/10"
                onClick={() => onJumpToChapter(i)}
              >
                {chapter.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={onTogglePause}
        >
          {paused ? (
            <>
              <Play className="h-3.5 w-3.5" /> Play
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause
            </>
          )}
        </Button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          ⌘/Ctrl + → for next chapter, from anywhere
        </p>
      </div>
    </div>
  );
}

import { Check, Clock } from "lucide-react";
import { flagUrl } from "@/lib/flags";
import { cn } from "@/lib/utils";
import type { Fixture, FixtureStatus } from "@/lib/types";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

const ROUNDS = ["R16", "QF", "SF", "FINAL"] as const;
type BracketStage = (typeof ROUNDS)[number];

const ROUND_LABELS: Record<BracketStage, string> = {
  R16: "Round of 16",
  QF: "Quarterfinal",
  SF: "Semifinal",
  FINAL: "Final",
};

const SLOT_COUNT: Record<BracketStage, number> = { R16: 8, QF: 4, SF: 2, FINAL: 1 };

/**
 * Official FIFA 2026 World Cup match numbers for these four rounds, out of
 * the tournament's 104 total — not invented here: the spec's own "W97 vs
 * W98" placeholder example *is* QF1/QF2's real numbers (SF1 is fed by the
 * winners of matches 97 and 98), so this table is just that convention
 * made complete for R16/QF/SF/Final.
 */
const MATCH_NUMBER_START: Record<BracketStage, number> = { R16: 89, QF: 97, SF: 101, FINAL: 104 };

/** Row-doubling bracket layout: round `r`'s slot spans `2^(r+1)` of a
 * `2^(rounds.length)`-row grid, positioned so every pair of adjacent-round
 * feeder slots shares an exact midpoint with the slot they feed — the
 * classic CSS-only bracket trick, computed once here rather than reflowed
 * per breakpoint. */
const TOTAL_ROWS = SLOT_COUNT.R16 * 2; // 16

function rowsPerSlot(stageIndex: number): number {
  return 2 ** (stageIndex + 1);
}

/** 0-indexed row offset of a slot's vertical center, in row units. */
function slotCenterRow(stageIndex: number, slotIndex: number): number {
  const span = rowsPerSlot(stageIndex);
  return slotIndex * span + span / 2;
}

interface BracketSlot {
  matchNumber: number;
  fixture: (Fixture & { score?: TrackedFixture["score"] }) | undefined;
  /** Only set when `fixture` is missing — the two FIFA match numbers
   * whose winners fill this slot, FIFA-style ("W97 vs W98"). */
  feederNumbers: [number, number] | null;
}

function buildRounds(fixtures: TrackedFixture[]): Record<BracketStage, BracketSlot[]> {
  const byStage: Record<BracketStage, TrackedFixture[]> = { R16: [], QF: [], SF: [], FINAL: [] };
  for (const f of fixtures) {
    if (f.stage === "R16" || f.stage === "QF" || f.stage === "SF" || f.stage === "FINAL") {
      byStage[f.stage].push(f);
    }
  }
  for (const stage of ROUNDS) {
    byStage[stage].sort((a, b) => a.kickoffTs - b.kickoffTs);
  }

  const rounds = {} as Record<BracketStage, BracketSlot[]>;
  ROUNDS.forEach((stage, roundIdx) => {
    const count = SLOT_COUNT[stage];
    const prevStage = roundIdx > 0 ? ROUNDS[roundIdx - 1] : null;
    const prevStart = prevStage ? MATCH_NUMBER_START[prevStage] : null;

    rounds[stage] = Array.from({ length: count }, (_, i) => {
      const fixture = byStage[stage][i];
      const feederNumbers: [number, number] | null =
        !fixture && prevStart !== null ? [prevStart + i * 2, prevStart + i * 2 + 1] : null;
      return { matchNumber: MATCH_NUMBER_START[stage] + i, fixture, feederNumbers };
    });
  });

  return rounds;
}

function TeamRow({
  name,
  winner,
  goals,
}: {
  name: string;
  winner: boolean;
  goals: number | undefined;
}) {
  const flag = flagUrl(name);
  return (
    <div className={cn("flex items-center justify-between gap-1.5 px-2.5 py-1.5", winner && "bg-primary/10")}>
      <span className="flex min-w-0 items-center gap-1.5">
        {flag && (
          <img
            src={flag}
            alt=""
            width={14}
            height={14}
            loading="lazy"
            decoding="async"
            className="h-3.5 w-3.5 shrink-0 rounded-full"
          />
        )}
        <span className={cn("truncate text-xs", winner ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {name}
        </span>
      </span>
      {goals !== undefined && (
        <span className={cn("tabular text-xs", winner ? "font-bold text-foreground" : "text-muted-foreground")}>
          {goals}
        </span>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: FixtureStatus }) {
  if (status === "FINISHED") {
    // "FT" (full-time), not "Final" — this pill sits inside every round's
    // chips, including the Final round itself, where "Final" would read
    // as a round label instead of a match-decided status.
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent-gold">
        <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
        FT
      </span>
    );
  }
  if (status === "LIVE") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-destructive">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
        </span>
        Live
      </span>
    );
  }
  if (status === "POSTPONED" || status === "CANCELLED") {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground line-through">
        {status === "POSTPONED" ? "Postponed" : "Cancelled"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <Clock className="h-2.5 w-2.5" aria-hidden />
      Pending
    </span>
  );
}

function BracketChip({ slot }: { slot: BracketSlot }) {
  if (!slot.fixture) {
    return (
      <div className="flex flex-col justify-center gap-1 rounded-lg border border-dashed border-border bg-card/40 px-2.5 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          W{slot.feederNumbers?.[0]} vs W{slot.feederNumbers?.[1]}
        </span>
        <span className="text-[10px] uppercase tracking-wide">TBD · Match {slot.matchNumber}</span>
      </div>
    );
  }

  const { fixture } = slot;
  const decided = fixture.status === "FINISHED" && fixture.score;
  const homeGoals = decided ? fixture.score!.home : undefined;
  const awayGoals = decided ? fixture.score!.away : undefined;
  const homeWins = decided && homeGoals! > awayGoals!;
  const awayWins = decided && awayGoals! > homeGoals!;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <TeamRow name={fixture.home} winner={Boolean(homeWins)} goals={homeGoals} />
      <div className="border-t border-border" />
      <TeamRow name={fixture.away} winner={Boolean(awayWins)} goals={awayGoals} />
      <div className="flex items-center justify-between border-t border-border bg-muted/40 px-2.5 py-1">
        <StatusPill status={fixture.status} />
        <span className="tabular text-[10px] text-muted-foreground">#{slot.matchNumber}</span>
      </div>
    </div>
  );
}

/** Percentage (0-100) vertical center of a slot within the shared
 * `TOTAL_ROWS`-row grid — used by both the CSS `grid-row` placement and
 * the SVG connector paths, so they can never disagree with each other. */
function slotCenterPercent(stageIndex: number, slotIndex: number): number {
  return (slotCenterRow(stageIndex, slotIndex) / TOTAL_ROWS) * 100;
}

/** One SVG per gap between round `stageIndex` and `stageIndex + 1` —
 * percentage coordinates (`viewBox="0 0 100 100"`, `preserveAspectRatio="none"`)
 * so the path fills whatever pixel width/height the grid gives its column,
 * no DOM measurement needed. */
function Connector({ stageIndex, count }: { stageIndex: number; count: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden
    >
      {Array.from({ length: count }, (_, j) => {
        const yA = slotCenterPercent(stageIndex, j * 2);
        const yB = slotCenterPercent(stageIndex, j * 2 + 1);
        const yTarget = slotCenterPercent(stageIndex + 1, j);
        return (
          <path
            key={j}
            d={`M 0 ${yA} H 50 V ${yB} M 0 ${yB} M 50 ${yTarget} H 100`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

export interface BracketViewProps {
  /** The full fixture set from `/api/fixtures` — filtered internally down
   * to R16/QF/SF/FINAL, so callers can pass the whole tournament list. */
  fixtures: TrackedFixture[];
  className?: string;
}

/**
 * Knockout bracket, Round of 16 through Final. Desktop (`lg+`): all four
 * rounds side by side on one CSS grid, connected by SVG lines. Below
 * `lg`: a per-round scroll-snap carousel instead — the connector geometry
 * only makes sense when every round is visible at once, so mobile trades
 * it for one full-width round per swipe.
 */
export function BracketView({ fixtures, className }: BracketViewProps) {
  const rounds = buildRounds(fixtures);

  return (
    <div className={className}>
      {/* Mobile: one round per snap-stop */}
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 lg:hidden">
        {ROUNDS.map((stage) => (
          <div key={stage} className="w-[85vw] max-w-sm shrink-0 snap-center">
            <p className="mb-3 font-display text-sm font-semibold text-foreground">
              {ROUND_LABELS[stage]}
            </p>
            <div className="flex flex-col gap-3">
              {rounds[stage].map((slot) => (
                <BracketChip key={slot.matchNumber} slot={slot} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: full grid + connectors */}
      <div className="hidden lg:block">
        <div className="mb-3 grid grid-cols-[240px_48px_240px_48px_240px_48px_240px] gap-0">
          {ROUNDS.map((stage, i) => (
            <p
              key={stage}
              className="font-display text-sm font-semibold text-foreground"
              style={{ gridColumn: i * 2 + 1 }}
            >
              {ROUND_LABELS[stage]}
            </p>
          ))}
        </div>

        <div
          className="grid gap-0"
          style={{
            gridTemplateColumns: "240px 48px 240px 48px 240px 48px 240px",
            gridTemplateRows: `repeat(${TOTAL_ROWS}, minmax(2.75rem, 1fr))`,
          }}
        >
          {ROUNDS.map((stage, roundIdx) => (
            <div key={stage} className="contents">
              {rounds[stage].map((slot, slotIdx) => {
                const span = rowsPerSlot(roundIdx);
                const start = slotIdx * span + 1;
                return (
                  <div
                    key={slot.matchNumber}
                    style={{
                      gridColumn: roundIdx * 2 + 1,
                      gridRow: `${start} / span ${span}`,
                    }}
                    className="flex items-center px-1"
                  >
                    <BracketChip slot={slot} />
                  </div>
                );
              })}
            </div>
          ))}

          {ROUNDS.slice(0, -1).map((stage, roundIdx) => (
            <div
              key={`connector-${stage}`}
              style={{ gridColumn: roundIdx * 2 + 2, gridRow: `1 / span ${TOTAL_ROWS}` }}
            >
              <Connector stageIndex={roundIdx} count={SLOT_COUNT[ROUNDS[roundIdx + 1]]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

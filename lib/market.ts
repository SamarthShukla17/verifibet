/**
 * Matches-page domain logic — filters (URL-shareable), fixture-status ->
 * market-status mapping, and the live/upcoming-by-day/earlier grouping
 * used by app/matches/(list)/page.tsx. Pure and framework-agnostic (no "use
 * client", no I/O) so it's testable without rendering anything (see
 * market.test.ts) and safely importable from both the Server Component
 * (page.tsx) and client pieces (FilterRailUrlSync, MatchesBoard) without
 * any client/server ambiguity.
 */
import type { FixtureStage, FixtureStatus, MarketStatus } from "@/lib/types";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

/** Shared with MatchCard.tsx and MatchHeader.tsx — one label per stage
 * code, kept here once both needed it rather than duplicated. */
export const STAGE_LABELS: Record<FixtureStage, string> = {
  GROUP: "Group Stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarterfinal",
  SF: "Semifinal",
  THIRD: "3rd Place",
  FINAL: "Final",
};

export const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
export const KNOCKOUT_STAGE_VALUES = ["R32", "R16", "QF", "SF", "FINAL"] as const;
export const STATUS_VALUES: readonly MarketStatus[] = ["OPEN", "LOCKED", "RESOLVED", "VOIDED"];

/**
 * The KO market rule: every stage except GROUP can't end in a draw (extra
 * time + penalties always produce a winner), so those markets only ever
 * offer two outcomes — home/away, no Draw. Deliberately `stage !== "GROUP"`
 * rather than reusing `KNOCKOUT_STAGE_VALUES` (that list backs the matches-
 * page stage *filter* dropdown and omits "THIRD" since the 3rd-place
 * playoff doesn't get its own filter tab — but it's still a knockout match
 * with no possible draw, so it must count here).
 */
export function isKnockoutStage(stage: FixtureStage): boolean {
  return stage !== "GROUP";
}

export type StageFilter =
  | "ALL"
  | `GROUP_${(typeof GROUPS)[number]}`
  | (typeof KNOCKOUT_STAGE_VALUES)[number];

export type StatusFilter = "ALL" | MarketStatus;

export interface MarketFilters {
  stage: StageFilter;
  status: StatusFilter;
  search: string;
}

export const DEFAULT_FILTERS: MarketFilters = { stage: "ALL", status: "ALL", search: "" };

const VALID_STAGE_FILTERS = new Set<string>([
  ...GROUPS.map((g) => `GROUP_${g}`),
  ...KNOCKOUT_STAGE_VALUES,
]);

function isStageFilter(value: string): value is StageFilter {
  return VALID_STAGE_FILTERS.has(value);
}

function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

/** Whether a fixture (+ its market status) passes the given filter set. */
export function matchesFilters(
  fixture: { home: string; away: string; stage: string; group?: string },
  marketStatus: MarketStatus,
  filters: MarketFilters,
): boolean {
  if (filters.stage !== "ALL") {
    if (filters.stage.startsWith("GROUP_")) {
      const group = filters.stage.slice("GROUP_".length);
      if (fixture.stage !== "GROUP" || fixture.group !== group) return false;
    } else if (fixture.stage !== filters.stage) {
      return false;
    }
  }

  if (filters.status !== "ALL" && marketStatus !== filters.status) return false;

  const query = filters.search.trim().toLowerCase();
  if (query) {
    const home = fixture.home.toLowerCase();
    const away = fixture.away.toLowerCase();
    if (!home.includes(query) && !away.includes(query)) return false;
  }

  return true;
}

/**
 * URL <-> MarketFilters — `?stage=QF&status=open&q=france`. `stage` is the
 * internal code verbatim (already URL-safe: "QF", "GROUP_A", ...); `status`
 * is lowercased for a friendlier-looking URL and parsed case-insensitively.
 * Accepts anything with a `.get(key)` method so both a real `URLSearchParams`
 * (client, via `useSearchParams()`) and a small adapter over Next's
 * plain-object `searchParams` (server `page.tsx` prop) share this one
 * implementation instead of two that could drift apart.
 */
export function parseMarketFilters(params: { get(key: string): string | null }): MarketFilters {
  const rawStage = params.get("stage");
  const rawStatus = params.get("status")?.toUpperCase() ?? "";
  const search = params.get("q") ?? "";

  return {
    stage: rawStage && isStageFilter(rawStage) ? rawStage : "ALL",
    status: isStatusFilter(rawStatus) ? rawStatus : "ALL",
    search,
  };
}

export function marketFiltersToSearchParams(filters: MarketFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.stage !== "ALL") params.set("stage", filters.stage);
  if (filters.status !== "ALL") params.set("status", filters.status.toLowerCase());
  if (filters.search.trim()) params.set("q", filters.search.trim());
  return params;
}

/**
 * A market's status is derived from its fixture's real-world progress —
 * there's no on-chain market data wired into this page yet (see
 * `components/bet/BetSlip.tsx`'s own "shell" doc comment), so this is the
 * closest honest approximation: betting is OPEN until kickoff, LOCKED for
 * the live match, RESOLVED once TxLINE reports it FINISHED, and VOIDED for
 * a fixture that will never produce a result.
 */
export function marketStatusFromFixtureStatus(status: FixtureStatus): MarketStatus {
  switch (status) {
    case "FINISHED":
      return "RESOLVED";
    case "LIVE":
      return "LOCKED";
    case "POSTPONED":
    case "CANCELLED":
      return "VOIDED";
    case "SCHEDULED":
    default:
      return "OPEN";
  }
}

export interface MarketEntry {
  fixture: TrackedFixture;
  marketStatus: MarketStatus;
}

export interface DayGroup {
  /** UTC calendar day as `YYYY-MM-DD` — a stable, collision-free React key. */
  dateKey: string;
  label: string;
  entries: MarketEntry[];
}

export interface OrganizedMatches {
  /** LIVE fixtures, always shown first regardless of day. */
  live: MarketEntry[];
  /** Everything else that hasn't finished, grouped by UTC calendar day —
   * soonest day first, soonest kickoff first within a day. */
  upcomingByDay: DayGroup[];
  /** FINISHED fixtures, most recently finished first — rendered inside
   * the "Earlier" accordion, not among the day groups above. */
  earlier: MarketEntry[];
  totalCount: number;
}

/**
 * UTC, not viewer-local: this grouping runs inside a Server Component,
 * which renders once server-side and never hydrates/re-runs client-side —
 * so there's no server/client mismatch risk either way, and UTC is the one
 * timezone every viewer of a worldwide tournament schedule can
 * cross-reference against the same header without ambiguity. (Each card's
 * own kickoff time still renders in the viewer's local time — see
 * MatchCard's `formatKickoff`.)
 */
function utcDateKey(kickoffTs: number): string {
  return new Date(kickoffTs * 1000).toISOString().slice(0, 10);
}

function formatDayLabel(kickoffTs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(kickoffTs * 1000));
}

export function organizeMatches(
  fixtures: readonly TrackedFixture[],
  filters: MarketFilters,
): OrganizedMatches {
  const entries: MarketEntry[] = fixtures
    .map(
      (fixture): MarketEntry => ({
        fixture,
        marketStatus: marketStatusFromFixtureStatus(fixture.status),
      }),
    )
    .filter((entry) => matchesFilters(entry.fixture, entry.marketStatus, filters));

  const live = entries
    .filter((e) => e.fixture.status === "LIVE")
    .sort((a, b) => a.fixture.kickoffTs - b.fixture.kickoffTs);

  const earlier = entries
    .filter((e) => e.fixture.status === "FINISHED")
    .sort((a, b) => b.fixture.kickoffTs - a.fixture.kickoffTs);

  const rest = entries
    .filter((e) => e.fixture.status !== "LIVE" && e.fixture.status !== "FINISHED")
    .sort((a, b) => a.fixture.kickoffTs - b.fixture.kickoffTs);

  const byDay = new Map<string, MarketEntry[]>();
  for (const entry of rest) {
    const key = utcDateKey(entry.fixture.kickoffTs);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }

  const upcomingByDay: DayGroup[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayEntries]) => ({
      dateKey,
      label: formatDayLabel(dayEntries[0].fixture.kickoffTs),
      entries: dayEntries,
    }));

  return { live, upcomingByDay, earlier, totalCount: entries.length };
}

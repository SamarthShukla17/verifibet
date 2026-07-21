"use client";

import { useId, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { MarketStatus } from "@/lib/types";

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

const KNOCKOUT_STAGES = [
  { value: "R32", label: "Round of 32" },
  { value: "R16", label: "Round of 16" },
  { value: "QF", label: "Quarterfinal" },
  { value: "SF", label: "Semifinal" },
  { value: "FINAL", label: "Final" },
] as const;

const STATUSES: { value: MarketStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "LOCKED", label: "Locked" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "VOIDED", label: "Voided" },
];

export type StageFilter =
  | "ALL"
  | `GROUP_${(typeof GROUPS)[number]}`
  | (typeof KNOCKOUT_STAGES)[number]["value"];

export type StatusFilter = "ALL" | MarketStatus;

export interface MarketFilters {
  stage: StageFilter;
  status: StatusFilter;
  search: string;
}

export const DEFAULT_FILTERS: MarketFilters = {
  stage: "ALL",
  status: "ALL",
  search: "",
};

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

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterContent({
  filters,
  onChange,
  searchId,
}: {
  filters: MarketFilters;
  onChange: (filters: MarketFilters) => void;
  searchId: string;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Search
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            placeholder="Search teams…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="pl-8"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={filters.status === "ALL"} onClick={() => onChange({ ...filters, status: "ALL" })}>
            All
          </FilterPill>
          {STATUSES.map((s) => (
            <FilterPill
              key={s.value}
              active={filters.status === s.value}
              onClick={() => onChange({ ...filters, status: s.value })}
            >
              {s.label}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage</p>

        <FilterPill active={filters.stage === "ALL"} onClick={() => onChange({ ...filters, stage: "ALL" })}>
          All stages
        </FilterPill>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Group Stage</p>
          <div className="grid grid-cols-6 gap-1.5">
            {GROUPS.map((g) => {
              const value: StageFilter = `GROUP_${g}`;
              const active = filters.stage === value;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => onChange({ ...filters, stage: value })}
                  aria-pressed={active}
                  className={cn(
                    "rounded-md border py-1 text-xs font-semibold tabular transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Knockout</p>
          <div className="flex flex-wrap gap-1.5">
            {KNOCKOUT_STAGES.map((s) => (
              <FilterPill
                key={s.value}
                active={filters.stage === s.value}
                onClick={() => onChange({ ...filters, stage: s.value })}
              >
                {s.label}
              </FilterPill>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface FilterRailProps {
  filters: MarketFilters;
  onChange: (filters: MarketFilters) => void;
}

/**
 * Desktop: a sticky left rail, always visible. Mobile (`<lg`): collapses to
 * a "Filters" trigger button that opens the same content in a shadcn Sheet
 * — one `FilterContent` implementation shared by both so the two surfaces
 * can't drift out of sync.
 */
export function FilterRail({ filters, onChange }: FilterRailProps) {
  const [open, setOpen] = useState(false);
  const desktopSearchId = useId();
  const mobileSearchId = useId();

  const activeCount =
    (filters.stage !== "ALL" ? 1 : 0) +
    (filters.status !== "ALL" ? 1 : 0) +
    (filters.search.trim() ? 1 : 0);

  return (
    <>
      <aside className="hidden lg:block lg:w-60 lg:shrink-0">
        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
          <FilterContent filters={filters} onChange={onChange} searchId={desktopSearchId} />
        </div>
      </aside>

      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeCount > 0 && (
                <span className="tabular ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 max-w-[85vw] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <FilterContent filters={filters} onChange={onChange} searchId={mobileSearchId} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

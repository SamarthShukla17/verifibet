import { cn } from "@/lib/utils";
import type { KeeperLogEntry } from "@/app/api/keeper/logs/route";

/**
 * One pill per recent-action row, colored by what actually happened —
 * same "colored border + 10%-opacity fill" pattern as
 * `components/market/MarketStatusBadge.tsx`, applied to keeper job
 * outcomes instead of market states:
 *
 * - `resolved`/`locked` (a real transaction landed) — primary (emerald).
 * - `skipped`/`dry_run` (a deliberate no-op) — muted, neither a success
 *   nor a failure worth calling out in color.
 * - a warn-level entry (`"... failed, retrying"`) — accent-gold, still
 *   in flight, not yet a real failure.
 * - an error-level entry (give-up, CPI validation failure, simulation
 *   failure) — destructive.
 */
export function KeeperStatusChip({ entry }: { entry: KeeperLogEntry }) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold";

  if (entry.action === "resolved" || entry.action === "locked") {
    return <span className={cn(base, "border-primary/50 text-primary")}>{entry.action === "resolved" ? "Resolved" : "Locked"}</span>;
  }
  if (entry.action === "skipped") {
    return <span className={cn(base, "border-border bg-muted text-muted-foreground")}>Skipped</span>;
  }
  if (entry.action === "dry_run") {
    return <span className={cn(base, "border-border bg-muted text-muted-foreground")}>Dry Run</span>;
  }
  if (entry.level >= 50) {
    return <span className={cn(base, "border-destructive/40 bg-destructive/10 text-destructive")}>Failed</span>;
  }
  if (entry.level >= 40) {
    return <span className={cn(base, "border-accent-gold/40 bg-accent-gold/10 text-accent-gold")}>Retrying</span>;
  }
  return <span className={cn(base, "border-border text-muted-foreground")}>{entry.msg || "—"}</span>;
}

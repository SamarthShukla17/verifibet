import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExplorerLink } from "@/components/ExplorerLink";
import { KeeperStatusChip } from "@/components/keeper/KeeperStatusChip";
import type { KeeperLogEntry } from "@/app/api/keeper/logs/route";

/** One row per real job outcome — `app/api/keeper/logs/route.ts` already
 * filtered out the poll-loop chatter (`progress: true` entries), so every
 * row here is either a completed action, a scheduled retry, or a real
 * failure, newest first. */
export function KeeperActionsTable({ entries }: { entries: KeeperLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
        No keeper activity logged yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>Fixture</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Tx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, i) => (
            <TableRow key={`${entry.time}-${i}`}>
              <TableCell className="tabular text-xs text-muted-foreground">
                {new Date(entry.time).toLocaleTimeString(undefined, { hour12: false })}
              </TableCell>
              <TableCell className="text-sm font-medium text-foreground">{entry.job}</TableCell>
              <TableCell className="tabular text-sm text-muted-foreground">{entry.fixtureId ?? "—"}</TableCell>
              <TableCell>
                <KeeperStatusChip entry={entry} />
                {entry.error && (
                  <p className="mt-1 max-w-xs truncate text-[11px] text-muted-foreground" title={entry.error}>
                    {entry.error}
                  </p>
                )}
              </TableCell>
              <TableCell>{entry.txSig ? <ExplorerLink kind="tx" value={entry.txSig} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

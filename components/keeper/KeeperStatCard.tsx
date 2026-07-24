import { cn } from "@/lib/utils";

export interface KeeperStatCardProps {
  label: string;
  value: string;
  detail?: string;
  /** Red border/text — e.g. the wallet balance card once SOL drops below
   * the alert threshold. A real signal, not decoration: this is the one
   * card style choice this dashboard uses to say "look at this now." */
  alert?: boolean;
  /** Keeper process unreachable (`healthz` came back `null`) — greyed
   * out rather than showing stale/zeroed numbers as if they were real. */
  offline?: boolean;
}

export function KeeperStatCard({ label, value, detail, alert, offline }: KeeperStatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4",
        alert ? "border-destructive/50 bg-destructive/5" : "border-border",
        offline && "opacity-60",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-1 text-xl font-bold", alert ? "text-destructive" : "text-foreground")}>
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

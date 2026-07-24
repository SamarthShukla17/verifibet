import { ExplorerLink } from "@/components/ExplorerLink";
import { CLUSTER, NETWORK } from "@/lib/config";
import { PROGRAM_ID } from "@/lib/solana/pda";

/**
 * The "Devnet" chip reads `CLUSTER` (see lib/config.ts), not a hardcoded
 * string — so it can't silently keep saying "Devnet" if this ever actually
 * ships to `NEXT_PUBLIC_CLUSTER=mainnet`. That's the whole point of calling
 * it "honest" in the spec: a network label that's wrong is worse than none.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-card/50">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-6 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
        <p className="text-sm text-muted-foreground">
          Every settlement verified via TxODDS TxLINE ⚡ Built on Solana
        </p>

        <div className="flex items-center gap-3">
          <ExplorerLink
            kind="program"
            value={PROGRAM_ID.toBase58()}
            display="VERIFIBET program"
            className="text-sm font-medium"
          />
          <ExplorerLink
            kind="program"
            value={NETWORK.txlineProgramId}
            display="TxLINE program"
            className="text-sm font-medium"
          />

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
            {CLUSTER === "devnet" ? "Devnet" : "Mainnet"}
          </span>
        </div>
      </div>
    </footer>
  );
}

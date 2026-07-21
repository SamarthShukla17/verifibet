import { ArrowUpRight } from "lucide-react";
import { CLUSTER } from "@/lib/config";

// Same fallback pattern as app/api/receipts/[fixtureId]/route.ts — the
// deployed devnet address from CLAUDE.md, overridable via env.
const PROGRAM_ID =
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw";

// Solana Explorer defaults to mainnet-beta with no query param at all —
// only append `?cluster=` for a non-mainnet cluster, so this link is
// correct in both directions rather than devnet-only.
const EXPLORER_URL = `https://explorer.solana.com/address/${PROGRAM_ID}${
  CLUSTER === "devnet" ? "?cluster=devnet" : ""
}`;

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
          <a
            href={EXPLORER_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View program
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
            {CLUSTER === "devnet" ? "Devnet" : "Mainnet"}
          </span>
        </div>
      </div>
    </footer>
  );
}

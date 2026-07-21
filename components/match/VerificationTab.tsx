import { ShieldCheck } from "lucide-react";

/**
 * Empty state only — Session 6.1 wires this up to the real
 * `Receipt`/proof data (see app/api/receipts/[fixtureId]/route.ts, which
 * already exists and does the real on-chain + TxLINE-proof assembly;
 * this tab just doesn't call it yet).
 */
export function VerificationTab() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
      <ShieldCheck className="h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="font-display text-base font-semibold text-foreground">
        Proof appears here at full time.
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Once this match is settled, the cryptographic proof TxLINE and this market's on-chain
        resolution are checked against — verifiable by anyone, not just us — shows up right here.
      </p>
    </div>
  );
}

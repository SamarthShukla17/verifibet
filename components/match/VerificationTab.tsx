"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ProofPanel } from "@/components/verification/ProofPanel";
import type { Receipt } from "@/lib/types";

export interface VerificationTabProps {
  fixtureId: number;
}

type FetchState =
  | { status: "loading" }
  | { status: "ready"; receipt: Receipt }
  /** Covers both real `ReceiptNotAvailableError` reasons from
   * `app/api/receipts/[fixtureId]/route.ts` (`no_market`/`not_resolved`)
   * and a genuine fetch failure — all three render the identical honest
   * empty state below. A market that hasn't synced yet, one that's open
   * but hasn't kicked off, and a transient RPC hiccup are all just
   * "nothing to show yet", not different flavors of broken. */
  | { status: "not_available" };

/**
 * Fetches `/api/receipts/:fixtureId` client-side (same pattern as
 * `ActivityTab.tsx`'s own client fetch) and switches between the
 * pre-existing empty state and `ProofPanel` — this file owns *when* a
 * proof is shown; `ProofPanel` owns *how*.
 */
export function VerificationTab({ fixtureId }: VerificationTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetch(`/api/receipts/${fixtureId}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "not_available" });
          return;
        }
        const receipt: Receipt = await res.json();
        setState({ status: "ready", receipt });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "not_available" });
      });

    return () => {
      cancelled = true;
    };
  }, [fixtureId]);

  if (state.status === "loading") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "ready") {
    return <ProofPanel receipt={state.receipt} />;
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
      <ShieldCheck className="h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="font-display text-base font-semibold text-foreground">
        Proof appears here at full time.
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Once this match is settled, the cryptographic proof TxLINE and this market&apos;s on-chain
        resolution are checked against — verifiable by anyone, not just us — shows up right here.
      </p>
    </div>
  );
}

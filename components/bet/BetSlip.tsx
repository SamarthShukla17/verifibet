"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { estimatePayout } from "@/lib/parimutuel";
import { formatUsdc, parseUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Outcome } from "@/lib/types";

export interface BetSlipSelection {
  fixtureId: number;
  home: string;
  away: string;
  outcome: Outcome;
  /** Decimal odds at selection time — display only; the payout preview
   * below is driven by `pools`/`estimatePayout`, not this number, since
   * a parimutuel payout was never actually determined by the quoted
   * decimal odds in the first place. */
  odds: number;
}

const OUTCOME_LABELS: Record<Outcome, (s: BetSlipSelection) => string> = {
  0: (s) => s.home,
  1: () => "Draw",
  2: (s) => s.away,
};

export interface BetSlipProps {
  selection: BetSlipSelection | null;
  /** USDC base units, 6dp, current on-chain pools for the selected
   * market — `[home, draw, away]`, matching the `Outcome` encoding. */
  pools: readonly [bigint, bigint, bigint];
  /** Controlled — raw `<input>` string, not yet parsed/validated. */
  amount: string;
  onAmountChange: (value: string) => void;
  onSubmit?: () => void;
  isSubmitting?: boolean;
  className?: string;
}

/**
 * SHELL for this session: the layout, the wallet gate, and the
 * (correctly-computed, real `estimatePayout`) preview are real; actually
 * building/sending a `place_bet` transaction on submit is not — that's
 * `onSubmit`'s job, supplied by whoever wires this up to the program
 * client. Fixed bottom-sheet on mobile (`<lg`); becomes a normal sticky
 * right rail at `lg:` and up rather than staying pinned to the viewport,
 * since a persistent bottom bar makes sense on a phone (thumb-reachable,
 * doesn't compete with page content) but not on a wide desktop layout
 * where a sidebar reads as the more natural placement.
 */
export function BetSlip({
  selection,
  pools,
  amount,
  onAmountChange,
  onSubmit,
  isSubmitting,
  className,
}: BetSlipProps) {
  const { connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();

  const amountBaseUnits = useMemo(() => parseUsdc(amount), [amount]);

  const estimatedPayout = useMemo(() => {
    if (!selection || amountBaseUnits === null || amountBaseUnits <= 0n) return null;
    return estimatePayout(pools, selection.outcome, amountBaseUnits);
  }, [selection, pools, amountBaseUnits]);

  const canSubmit =
    connected && selection !== null && amountBaseUnits !== null && amountBaseUnits > 0n;

  return (
    <div
      className={cn(
        "glass fixed inset-x-0 bottom-0 z-40 rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
        "lg:sticky lg:top-20 lg:inset-x-auto lg:bottom-auto lg:w-80 lg:rounded-2xl lg:p-5",
        className,
      )}
    >
      <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Bet Slip
      </p>

      {!selection ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Select an outcome on any match to build a bet.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {/* Selection summary */}
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              {selection.home} vs {selection.away}
            </p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-display text-sm font-semibold text-foreground">
                {OUTCOME_LABELS[selection.outcome](selection)}
              </span>
              <span className="tabular text-lg font-bold text-primary">
                {selection.odds.toFixed(3)}
              </span>
            </div>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <label htmlFor="bet-amount" className="text-xs font-medium text-muted-foreground">
              Amount (USDC)
            </label>
            <Input
              id="bet-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              className="tabular text-lg"
            />
          </div>

          {/* Payout preview */}
          <div className="rounded-lg bg-muted p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Estimated payout</span>
              <span className="tabular text-xl font-bold text-accent-gold">
                {estimatedPayout !== null ? formatUsdc(estimatedPayout) : "—"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              estimated — pools move until kickoff
            </p>
          </div>

          {/* CTA */}
          {connected ? (
            <Button
              className="w-full glow-emerald"
              size="lg"
              disabled={!canSubmit || isSubmitting}
              onClick={onSubmit}
            >
              {isSubmitting ? "Placing bet…" : "Place Bet"}
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              variant="secondary"
              onClick={() => setWalletModalVisible(true)}
            >
              Connect Wallet to Bet
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HoldToConfirmButton } from "@/components/bet/HoldToConfirmButton";
import { ConfettiBurst } from "@/components/bet/ConfettiBurst";
import { InfoTooltip } from "@/components/InfoTooltip";
import { estimatePayout } from "@/lib/parimutuel";
import { formatUsdc, parseUsdc, usdcToInputValue } from "@/lib/format";
import { explorerTxUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";
import type { MarketStatus, Outcome } from "@/lib/types";

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

const QUICK_AMOUNTS = [5, 25, 100] as const;

function outcomeName(s: BetSlipSelection): string {
  return s.outcome === 0 ? s.home : s.outcome === 1 ? "Draw" : s.away;
}

/** "France wins" / "the match is a draw" — the one place both flavors of
 * this phrasing come from, so the payout-preview heading and the confirm
 * step's summary can't drift apart. */
function outcomeWinPhrase(s: BetSlipSelection): string {
  return s.outcome === 1 ? "the match is a draw" : `${outcomeName(s)} wins`;
}

function formatKickoffTime(kickoffTs: number): string {
  // No explicit `timeZone` — viewer-local, same convention as MatchHeader/
  // MatchCard's own `formatKickoff`. 24h `HH:MM`, not the app's usual
  // verbose "weekday, month day, hour:min" — this is a short inline status
  // line, not a header.
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(kickoffTs * 1000),
  );
}

export interface BetSlipProps {
  selection: BetSlipSelection | null;
  /** USDC base units, 6dp, current on-chain pools for the selected
   * market — `[home, draw, away]`, matching the `Outcome` encoding. */
  pools: readonly [bigint, bigint, bigint];
  marketStatus: MarketStatus;
  kickoffTs: number;
  /** USDC base units, 6dp — the connected wallet's current balance (see
   * `lib/hooks/useBalances.ts`). `0n` with no wallet connected. */
  balance: bigint;
  balanceLoading?: boolean;
  /** Controlled — raw `<input>` string, not yet parsed/validated. */
  amount: string;
  onAmountChange: (value: string) => void;
  /** Builds + sends the real `place_bet` transaction and resolves with its
   * signature. Rejects on failure or wallet rejection — the caller's
   * `sendAndConfirm` call already shows a human-readable toast for that,
   * so this component just falls back to the editable state rather than
   * showing a second error of its own. */
  onSubmit: () => Promise<string>;
  className?: string;
}

type Phase = "edit" | "confirm" | "submitting" | "success";

/**
 * The success state's own badge — an empty circle that springs in, then
 * a checkmark path draws itself in right after ("morphs" from a plain
 * circle into a check, not two separate static states swapped). Static
 * (no `motion`, already-drawn check) under `prefers-reduced-motion`.
 */
function CheckMorph({ reduceMotion }: { reduceMotion: boolean }) {
  if (reduceMotion) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <motion.div
      className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground"
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
        <motion.path
          d="M5 13l4 4L19 7"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );
}

/**
 * The full bet-placement flow for one selected outcome: amount entry with
 * quick chips + live inline validation, an in-slip hold-to-confirm step,
 * and a success state — no page navigation or modal at any point, the
 * whole thing lives in this one sticky/bottom-sheet panel. Fixed
 * bottom-sheet on mobile (`<lg`); becomes a normal sticky right rail at
 * `lg:` and up rather than staying pinned to the viewport, since a
 * persistent bottom bar makes sense on a phone (thumb-reachable, doesn't
 * compete with page content) but not on a wide desktop layout where a
 * sidebar reads as the more natural placement.
 */
export function BetSlip({
  selection,
  pools,
  marketStatus,
  kickoffTs,
  balance,
  balanceLoading,
  amount,
  onAmountChange,
  onSubmit,
  className,
}: BetSlipProps) {
  const { connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const reduceMotion = useReducedMotion() ?? false;

  const [phase, setPhase] = useState<Phase>("edit");
  const [touched, setTouched] = useState(false);
  const [successSig, setSuccessSig] = useState<string | null>(null);

  // A fresh selection (new outcome, or a different match entirely) always
  // starts from a clean slip — a stale confirm/success view for whatever
  // was selected before would otherwise linger onto the new one.
  useEffect(() => {
    setPhase("edit");
    setTouched(false);
    setSuccessSig(null);
  }, [selection?.fixtureId, selection?.outcome]);

  const trimmedAmount = amount.trim();
  const amountBaseUnits = useMemo(() => parseUsdc(amount), [amount]);

  const validationMessage = useMemo(() => {
    if (!touched && trimmedAmount === "") return null;
    if (trimmedAmount === "") return "Enter an amount to bet";
    if (amountBaseUnits === null) return "Enter a valid amount";
    if (amountBaseUnits <= 0n) return "Enter an amount greater than zero";
    if (amountBaseUnits > balance) return `Not enough USDC — you have ${formatUsdc(balance)}`;
    return null;
  }, [touched, trimmedAmount, amountBaseUnits, balance]);

  const canPlaceBet = amountBaseUnits !== null && amountBaseUnits > 0n && amountBaseUnits <= balance;

  const estimatedPayout = useMemo(() => {
    if (!selection || amountBaseUnits === null || amountBaseUnits <= 0n) return null;
    return estimatePayout(pools, selection.outcome, amountBaseUnits);
  }, [selection, pools, amountBaseUnits]);

  async function handleHoldConfirm() {
    setPhase("submitting");
    try {
      const sig = await onSubmit();
      setSuccessSig(sig);
      setPhase("success");
    } catch {
      // sendAndConfirm already surfaced a human-readable toast — the slip
      // itself just drops back to editable rather than piling on a
      // second error message.
      setPhase("edit");
    }
  }

  function handlePlaceBetClick() {
    setTouched(true);
    if (canPlaceBet) setPhase("confirm");
  }

  function resetForAnotherBet() {
    onAmountChange("");
    setTouched(false);
    setPhase("edit");
    setSuccessSig(null);
  }

  const isOpen = marketStatus === "OPEN";

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
      ) : !isOpen ? (
        <div className="mt-3 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
          {marketStatus === "LOCKED" && `Betting closed at kickoff ${formatKickoffTime(kickoffTs)}`}
          {marketStatus === "RESOLVED" && "Market settled — see the Activity tab"}
          {marketStatus === "VOIDED" && "Market voided — bets are refundable"}
        </div>
      ) : !connected ? (
        <div className="mt-3 space-y-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              {selection.home} vs {selection.away}
            </p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-display text-sm font-semibold text-foreground">
                {outcomeName(selection)}
              </span>
              <span className="tabular text-lg font-bold text-primary">{selection.odds.toFixed(3)}</span>
            </div>
          </div>
          <Button className="w-full" size="lg" variant="secondary" onClick={() => setWalletModalVisible(true)}>
            Connect Wallet to Bet
          </Button>
        </div>
      ) : phase === "success" ? (
        <div className="relative mt-3 flex flex-col items-center gap-3 overflow-hidden py-4 text-center">
          <ConfettiBurst />
          <CheckMorph reduceMotion={reduceMotion} />
          <p className="font-display text-lg font-semibold text-foreground">Bet placed!</p>
          <p className="text-xs text-muted-foreground">
            {formatUsdc(amountBaseUnits ?? 0n)} USDC on {outcomeName(selection)}
          </p>
          {successSig && (
            <a
              href={explorerTxUrl(successSig)}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary hover:underline"
            >
              View position
            </a>
          )}
          <Button className="w-full" size="lg" variant="secondary" onClick={resetForAnotherBet}>
            Place another bet
          </Button>
        </div>
      ) : phase === "confirm" || phase === "submitting" ? (
        <div className="mt-3 space-y-4">
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">Confirm your bet</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {formatUsdc(amountBaseUnits ?? 0n)} USDC on {outcomeName(selection)}
            </p>
            {estimatedPayout !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                If {outcomeWinPhrase(selection)}, you get back ~{formatUsdc(estimatedPayout)} USDC
              </p>
            )}
          </div>

          <HoldToConfirmButton onConfirm={handleHoldConfirm} disabled={phase === "submitting"}>
            {phase === "submitting" ? "Placing bet…" : "Hold to confirm"}
          </HoldToConfirmButton>

          <button
            type="button"
            disabled={phase === "submitting"}
            onClick={() => setPhase("edit")}
            className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {/* Selection summary */}
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              {selection.home} vs {selection.away}
            </p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-display text-sm font-semibold text-foreground">
                {outcomeName(selection)}
              </span>
              <span className="tabular text-lg font-bold text-primary">{selection.odds.toFixed(3)}</span>
            </div>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="bet-amount" className="text-xs font-medium text-muted-foreground">
                Amount (USDC)
              </label>
              <span className="tabular text-[11px] text-muted-foreground">
                Balance: {balanceLoading ? "…" : formatUsdc(balance)}
              </span>
            </div>
            <Input
              id="bet-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setTouched(true);
                onAmountChange(e.target.value);
              }}
              className="tabular text-lg"
            />
            {validationMessage && <p className="text-xs text-destructive">{validationMessage}</p>}

            {/* Quick chips */}
            <div className="flex gap-1.5 pt-0.5">
              {QUICK_AMOUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setTouched(true);
                    onAmountChange(String(n));
                  }}
                  className="flex-1 rounded-md border border-border bg-muted py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  ${n}
                </button>
              ))}
              <button
                type="button"
                disabled={balanceLoading}
                onClick={() => {
                  setTouched(true);
                  onAmountChange(usdcToInputValue(balance));
                }}
                className="flex-1 rounded-md border border-border bg-muted py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Payout preview */}
          <div className="rounded-lg bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                If {outcomeWinPhrase(selection)}
                <InfoTooltip text="You're betting against the pool, not the house." />
              </span>
              <span className="tabular text-xl font-bold text-accent-gold">
                {estimatedPayout !== null ? formatUsdc(estimatedPayout) : "—"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              estimated — pools move until kickoff
            </p>
          </div>

          {/* CTA — deliberately never `disabled`: an invalid amount still
              gets a clickable button, it just surfaces the inline
              validation message above instead of doing nothing silently. */}
          <Button className="w-full glow-emerald" size="lg" onClick={handlePlaceBetClick}>
            Place Bet
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { flagUrl } from "@/lib/flags";
import { formatUsdc } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/market";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/bet/ShareButton";
import { useClaimRefund } from "@/lib/hooks/useClaimRefund";
import { useClaimWinnings } from "@/lib/hooks/useClaimWinnings";
import { cn } from "@/lib/utils";
import type { Position, PositionStatus } from "@/lib/hooks/useMyBets";

export interface PositionRowProps {
  position: Position;
  className?: string;
  /** Re-fetches this wallet's positions after a refund lands — threaded
   * down from `useMyBets()`'s own `refresh` (see `app/portfolio/page.tsx`)
   * so a claimed refund's status flips to `claimed` without a manual
   * reload. Optional: nothing breaks if a call site doesn't pass it,
   * `RefundButton` just won't auto-refresh its own row afterward. */
  onClaimed?: () => void;
}

function formatKickoff(kickoffTs: number): string {
  // No explicit `timeZone` — viewer-local, same convention as every other
  // kickoff formatter in this app (MatchCard, MatchHeader, BetSlip).
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(kickoffTs * 1000));
}

function TeamFlag({ name }: { name: string }) {
  const src = flagUrl(name);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
    />
  );
}

/**
 * Label + icon per settled status — colors deliberately don't recolor the
 * whole row (see `PositionRow`'s own doc comment): `won`/`claimed` read
 * emerald (`text-primary`, this app's emerald), `lost` reads muted, and
 * `refundable` stays neutral since a voided market isn't a win or a loss.
 * The one color this table *doesn't* own is gold — that's reserved for
 * the CLAIM button alone (`won`/`refundable`, whichever isn't claimed
 * yet), so a claimable position's call-to-action pops the same way
 * regardless of which of the two claimable statuses it is.
 */
const STATUS_META: Record<PositionStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  won: { label: "Won", className: "text-primary" },
  claimed: { label: "Claimed", className: "text-primary" },
  lost: { label: "Lost", className: "text-muted-foreground" },
  refundable: { label: "Voided", className: "text-muted-foreground" },
};

/**
 * Sends an actual `claim_winnings` transaction
 * (`lib/hooks/useClaimWinnings.ts`) and drives the same toast lifecycle
 * every other real transaction in this app does (`sendAndConfirm`) — was
 * a "Phase 6" placeholder toast until Session 7's demo rehearsal needed
 * a genuinely working CLAIM button to record the full bet-to-receipt
 * path. Same shape as `RefundButton` below, applied to the winnings side.
 */
function ClaimButton({
  fixtureId,
  outcome,
  onClaimed,
}: {
  fixtureId: number;
  outcome: Position["outcome"];
  onClaimed?: () => void;
}) {
  const { claimWinnings } = useClaimWinnings(onClaimed);
  const [claiming, setClaiming] = useState(false);

  async function handleClick() {
    if (claiming) return;
    setClaiming(true);
    try {
      await claimWinnings(fixtureId, outcome);
    } catch {
      // sendAndConfirm already showed the error/rejection toast — nothing
      // further to do here.
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Button
      size="sm"
      className="bg-accent-gold text-accent-gold-foreground hover:bg-accent-gold/90"
      onClick={() => void handleClick()}
      disabled={claiming}
    >
      {claiming ? "Claiming…" : "Claim"}
    </Button>
  );
}

/**
 * Sends an actual `claim_refund` transaction (`lib/hooks/useClaimRefund.ts`)
 * and drives the same toast lifecycle every other real transaction in
 * this app does (`sendAndConfirm`).
 */
function RefundButton({
  fixtureId,
  outcome,
  onClaimed,
}: {
  fixtureId: number;
  outcome: Position["outcome"];
  onClaimed?: () => void;
}) {
  const { claimRefund } = useClaimRefund(onClaimed);
  const [claiming, setClaiming] = useState(false);

  async function handleClick() {
    if (claiming) return;
    setClaiming(true);
    try {
      await claimRefund(fixtureId, outcome);
    } catch {
      // sendAndConfirm already showed the error/rejection toast — nothing
      // further to do here.
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Button
      size="sm"
      className="bg-accent-gold text-accent-gold-foreground hover:bg-accent-gold/90"
      onClick={() => void handleClick()}
      disabled={claiming}
    >
      {claiming ? "Refunding…" : "Refund"}
    </Button>
  );
}

/**
 * One row in the "My Bets" list — the matchup, what was picked, the
 * stake, and whatever's most relevant about its outcome: a live "if this
 * resolved right now" estimate while `pending` (recomputed every time
 * `useMyBets` polls — see that hook's own "only while LIVE" polling
 * doc comment), or the real settled amount once the market's moved past
 * that (`won`/`claimed` in emerald, `lost` muted, `refundable` neutral
 * with an explicit "Match voided — full refund available" line).
 * `refundable`'s REFUND button and `won`'s CLAIM button are both real —
 * `RefundButton`/`ClaimButton` send actual `claim_refund`/`claim_winnings`
 * transactions.
 */
export function PositionRow({ position, className, onClaimed }: PositionRowProps) {
  const { fixtureId, home, away, stage, kickoffTs, fixtureStatus, pickLabel, outcome, amount, status, estPayout, payout } =
    position;
  const meta = STATUS_META[status];
  const isLive = fixtureStatus === "LIVE";

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{stage ? STAGE_LABELS[stage] : "Match"}</span>
        <div className="flex items-center gap-1">
          <span className="tabular flex items-center gap-1.5">
            {isLive && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
              </span>
            )}
            {isLive ? "LIVE" : formatKickoff(kickoffTs)}
          </span>
          <ShareButton position={position} />
        </div>
      </div>

      <div className="mt-1.5 min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {home} <span className="font-normal text-muted-foreground">vs</span> {away}
        </p>
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
          <TeamFlag name={pickLabel} />
          {pickLabel}
        </span>
        {status === "refundable" && (
          <p className="mt-2 text-xs font-medium text-muted-foreground">Match voided — full refund available</p>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Stake</p>
          <p className="tabular text-sm font-semibold text-foreground">{formatUsdc(amount)} USDC</p>
        </div>

        {status === "pending" ? (
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              Est. payout
            </p>
            <p className="tabular text-sm font-bold text-foreground">
              {estPayout !== null ? formatUsdc(estPayout) : "—"} USDC
            </p>
          </div>
        ) : status === "lost" ? (
          <div className="flex items-center gap-1.5 text-right">
            <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className={cn("text-sm font-semibold", meta.className)}>{meta.label}</span>
          </div>
        ) : status === "claimed" ? (
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Check className="h-3 w-3 text-primary" strokeWidth={3} aria-hidden />
              {meta.label}
            </p>
            <p className={cn("tabular text-sm font-bold", meta.className)}>
              {payout !== null ? formatUsdc(payout) : "—"} USDC
            </p>
          </div>
        ) : status === "refundable" ? (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className={cn("text-[11px] uppercase tracking-wide", meta.className)}>{meta.label}</p>
              <p className={cn("tabular text-sm font-bold", meta.className)}>
                {payout !== null ? formatUsdc(payout) : "—"} USDC
              </p>
            </div>
            <RefundButton fixtureId={fixtureId} outcome={outcome} onClaimed={onClaimed} />
          </div>
        ) : (
          // won, unclaimed
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className={cn("text-[11px] uppercase tracking-wide", meta.className)}>{meta.label}</p>
              <p className={cn("tabular text-sm font-bold", meta.className)}>
                {payout !== null ? formatUsdc(payout) : "—"} USDC
              </p>
            </div>
            <ClaimButton fixtureId={fixtureId} outcome={outcome} onClaimed={onClaimed} />
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { ArrowUpRight, Droplets, X } from "lucide-react";

const CIRCLE_FAUCET_URL = "https://faucet.circle.com";

export interface HelpCardProps {
  onDismiss: () => void;
}

/**
 * "You have no devnet USDC yet" nudge — surfaced right after connecting
 * a wallet with a zero/missing USDC balance (see WalletUx.tsx, which
 * decides *when* to show this; this component only renders it). Delivered
 * through a persistent sonner toast rather than its own hand-positioned
 * `fixed` element — sonner already owns a corner of the viewport that
 * BetSlip's own fixed bottom-sheet (components/bet/BetSlip.tsx) never
 * touches, so reusing it sidesteps a real cross-component z-index/position
 * collision instead of fighting it with more `fixed` CSS.
 */
export function HelpCard({ onDismiss }: HelpCardProps) {
  return (
    <div className="glass w-[min(22rem,calc(100vw-2rem))] rounded-xl p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Droplets className="h-[1.125rem] w-[1.125rem]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-foreground">No devnet USDC yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You&apos;ll need some to place a bet. Circle&apos;s devnet faucet covers it — the mint every
            market on this build actually settles in.
          </p>
          <a
            href={CIRCLE_FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Get devnet USDC
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

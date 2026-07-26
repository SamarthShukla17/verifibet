"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PositionRow } from "@/components/bet/PositionRow";
import { StreakChip } from "@/components/bet/StreakChip";
import { useMyBets } from "@/lib/hooks/useMyBets";
import type { Position } from "@/lib/hooks/useMyBets";
import { useClaimWinnings } from "@/lib/hooks/useClaimWinnings";
import { useClaimRefund } from "@/lib/hooks/useClaimRefund";
import {
  claimablePositions,
  computePortfolioStats,
  filterPositionsForTab,
  type PortfolioTab,
} from "@/lib/portfolio";
import { formatSignedUsdc, formatUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS: { value: PortfolioTab; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "settled", label: "Settled" },
  { value: "all", label: "All" },
];

const EMPTY_COPY: Record<PortfolioTab, string> = {
  active: "No active bets right now.",
  settled: "Nothing settled yet — check back after kickoff.",
  all: "You haven't placed a bet yet.",
};

/** Gap between each real claim transaction in the "Claim All" sequence —
 * long enough that each one's own toast is actually readable before the
 * next fires, not simulating any real confirmation latency (`sendAndConfirm`
 * itself already waits for a real confirmation per position). */
const CLAIM_GAP_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StatCard({
  label,
  value,
  valueClassName,
  children,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-1 text-xl font-bold text-foreground", valueClassName)}>{value}</p>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function EmptyTabState({ tab }: { tab: PortfolioTab }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
      <p className="text-sm text-muted-foreground">{EMPTY_COPY[tab]}</p>
      <Button asChild className="mt-4" variant="secondary">
        <Link href="/matches">Browse Matches</Link>
      </Button>
    </div>
  );
}

function ConnectPrompt({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
      <p className="text-sm text-muted-foreground">Connect your wallet to see your positions.</p>
      <Button className="mt-4" variant="secondary" onClick={onConnect}>
        Connect Wallet
      </Button>
    </div>
  );
}

function PositionsList({
  connected,
  loading,
  positions,
  tab,
  onConnect,
  onClaimed,
}: {
  connected: boolean;
  loading: boolean;
  positions: Position[] | null;
  tab: PortfolioTab;
  onConnect: () => void;
  onClaimed: () => void;
}) {
  if (!connected) return <ConnectPrompt onConnect={onConnect} />;

  if (loading && positions === null) {
    return (
      <>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </>
    );
  }

  const filtered = filterPositionsForTab(positions ?? [], tab);
  if (filtered.length === 0) return <EmptyTabState tab={tab} />;

  return (
    <>
      {filtered.map((position) => (
        <PositionRow key={position.betPda} position={position} onClaimed={onClaimed} />
      ))}
    </>
  );
}

/**
 * The richer "My Bets" destination — stat cards (active stake, claimable,
 * realized P&L, W-L) over `computePortfolioStats`, Active/Settled/All
 * tabs over `filterPositionsForTab` (both `lib/portfolio.ts`, kept pure
 * and tested there rather than computed inline here), and a "Claim All"
 * affordance. `app/bets` now just redirects here — see that route's own
 * comment for why this superseded it instead of the two living side by
 * side.
 */
export default function PortfolioPage() {
  const { connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { positions, loading, refresh } = useMyBets();
  const [tab, setTab] = useState<PortfolioTab>("active");
  const [claimAllProgress, setClaimAllProgress] = useState<{ current: number; total: number } | null>(null);

  const stats = useMemo(() => computePortfolioStats(positions ?? []), [positions]);
  const claimable = useMemo(() => claimablePositions(positions ?? []), [positions]);
  const { claimWinnings } = useClaimWinnings();
  const { claimRefund } = useClaimRefund();

  /**
   * Sequential, one position at a time, each with its own progress toast
   * — real `claim_winnings`/`claim_refund` transactions now (Session 7's
   * demo rehearsal wired both), dispatched per position based on its own
   * `status` (`won` -> `claim_winnings`, `refundable` -> `claim_refund`;
   * `claimablePositions` never returns anything else). One position
   * failing (a rejected wallet popup, an RPC hiccup) doesn't abort the
   * rest — `sendAndConfirm` already surfaces that position's own
   * error/rejection toast, and the loop just moves on to the next one.
   */
  async function handleClaimAll() {
    if (claimAllProgress !== null || claimable.length === 0) return;
    const total = claimable.length;

    for (let i = 0; i < total; i++) {
      const position = claimable[i];
      setClaimAllProgress({ current: i + 1, total });
      try {
        if (position.status === "won") {
          await claimWinnings(position.fixtureId, position.outcome);
        } else {
          await claimRefund(position.fixtureId, position.outcome);
        }
      } catch {
        // sendAndConfirm already showed the error/rejection toast.
      }
      await sleep(CLAIM_GAP_MS);
    }

    refresh();
    setClaimAllProgress(null);
  }

  const hasPositions = connected && positions !== null && positions.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Portfolio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every position you&apos;ve staked, straight from your own on-chain bets.
            </p>
          </div>

          {connected && claimable.length > 0 && (
            <Button
              className="bg-accent-gold text-accent-gold-foreground hover:bg-accent-gold/90"
              onClick={() => void handleClaimAll()}
              disabled={claimAllProgress !== null}
            >
              {claimAllProgress
                ? `Claiming ${claimAllProgress.current}/${claimAllProgress.total}…`
                : `Claim All (${claimable.length})`}
            </Button>
          )}
        </div>

        {hasPositions && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Active Stake" value={`${formatUsdc(stats.activeStake)} USDC`} />
            <StatCard
              label="Claimable"
              value={`${formatUsdc(stats.claimable)} USDC`}
              valueClassName={stats.claimable > 0n ? "text-accent-gold" : undefined}
            />
            <StatCard
              label="Total P&L"
              value={`${formatSignedUsdc(stats.pnl)} USDC`}
              valueClassName={stats.pnl > 0n ? "text-primary" : stats.pnl < 0n ? "text-destructive" : undefined}
            />
            <StatCard label="W–L Record" value={`${stats.wins}–${stats.losses}`}>
              {stats.streak > 0 && <StreakChip streak={stats.streak} />}
            </StatCard>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as PortfolioTab)} className="mt-6">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="space-y-3">
              <PositionsList
                connected={connected}
                loading={loading}
                positions={positions}
                tab={t.value}
                onConnect={() => setWalletModalVisible(true)}
                onClaimed={refresh}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <Footer />
    </div>
  );
}

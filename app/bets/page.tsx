"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PositionRow } from "@/components/bet/PositionRow";
import { useMyBets } from "@/lib/hooks/useMyBets";

/**
 * Purely client-driven (no server data fetch): every position comes from
 * the connected wallet's own on-chain `Bet`s (`useMyBets`), so there's
 * nothing meaningful to render for this route server-side the way
 * `app/matches/[fixtureId]/page.tsx` pre-fetches fixture data — Navbar/
 * Footer are composed inline here rather than via a shared layout, same
 * as that page, since there's no sibling route under `/bets` needing one.
 */
export default function BetsPage() {
  const { connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { positions, loading } = useMyBets();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-foreground">My Bets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every position you've staked, straight from your own on-chain bets.
        </p>

        <div className="mt-6 space-y-3">
          {!connected ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
              <p className="text-sm text-muted-foreground">Connect your wallet to see your positions.</p>
              <Button className="mt-4" variant="secondary" onClick={() => setWalletModalVisible(true)}>
                Connect Wallet
              </Button>
            </div>
          ) : loading && positions === null ? (
            <>
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </>
          ) : positions !== null && positions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
              No bets yet — head to Matches to place one.
            </div>
          ) : (
            positions?.map((position) => <PositionRow key={position.betPda} position={position} />)
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}

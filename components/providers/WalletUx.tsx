"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { HelpCard } from "@/components/wallet/HelpCard";

/**
 * Circle's real devnet USDC-Dev mint — deliberately hardcoded here, not
 * `CONFIG.devnet.usdcMint`. That config value currently resolves to this
 * project's own mock mint (`NEXT_PUBLIC_USDC_MINT` in `.env.local` — see
 * README.md's "Plan notes"), used by `scripts/sync-markets.ts` for markets
 * it initializes *from now on*. But a `Market.usdc_mint` is fixed forever
 * at `initialize_market` and can't change afterward, and every market that
 * already exists on devnet today was created before that mock-mint pivot —
 * confirmed by a real on-chain read, not assumed (see NOTES.md). Circle's
 * faucet only ever funds Circle's own mint, so checking the mock mint here
 * would send a first-time visitor to fund a token account that can't
 * actually place a bet on any market that exists right now.
 */
const CIRCLE_DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/** `true` only when we can positively confirm zero/no USDC — a network
 * hiccup checking the balance returns `false` (unknown), not a false
 * "you're broke": that's a separate concern (see NetworkGuard.tsx), and
 * conflating the two would show a misleading nudge over a connectivity
 * problem. */
async function hasZeroOrMissingUsdc(connection: Connection, owner: PublicKey): Promise<boolean> {
  const ata = getAssociatedTokenAddressSync(CIRCLE_DEVNET_USDC_MINT, owner);
  const accountInfo = await connection.getAccountInfo(ata);
  if (!accountInfo) return true; // ATA never created — definitely zero.
  const balance = await connection.getTokenAccountBalance(ata);
  return balance.value.amount === "0";
}

/**
 * Two pieces of first-connect UX, both keyed off `useWallet().connected`
 * transitioning false -> true: a "Connected · devnet" toast (always), and
 * — only once we can positively confirm the wallet has no USDC — a
 * persistent `HelpCard` toast pointing at Circle's faucet. Mounted once
 * inside WalletProvider.tsx, alongside `{children}`, so it shares the same
 * wallet-adapter context via hooks rather than needing anything threaded
 * in as props.
 */
export function WalletUx() {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const wasConnected = useRef(false);

  useEffect(() => {
    if (connected && publicKey && !wasConnected.current) {
      toast.success("Connected · devnet");

      let cancelled = false;
      hasZeroOrMissingUsdc(connection, publicKey)
        .then((isZero) => {
          if (cancelled || !isZero) return;
          toast.custom((id) => <HelpCard onDismiss={() => toast.dismiss(id)} />, {
            duration: Infinity,
          });
        })
        .catch(() => {
          // Unknown balance (RPC hiccup) — say nothing rather than guess.
        });

      wasConnected.current = true;
      return () => {
        cancelled = true;
      };
    }

    wasConnected.current = connected;
  }, [connected, publicKey, connection]);

  return null;
}

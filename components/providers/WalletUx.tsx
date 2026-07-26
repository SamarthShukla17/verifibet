"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { HelpCard } from "@/components/wallet/HelpCard";
import { CIRCLE_DEVNET_USDC_MINT } from "@/lib/config";

/** `true` only when we can positively confirm zero/no USDC — a network
 * hiccup checking the balance returns `false` (unknown), not a false
 * "you're broke": that's a separate concern (see NetworkGuard.tsx), and
 * conflating the two would show a misleading nudge over a connectivity
 * problem.
 *
 * `@solana/spl-token` is imported dynamically here (see
 * `lib/solana/program.ts`'s doc comment) — this whole component is
 * itself dynamic-imported with `ssr: false` from `WalletProvider.tsx` for
 * the same reason, but the inner dynamic import stays too in case this
 * function is ever called from somewhere that isn't already lazy. */
async function hasZeroOrMissingUsdc(connection: Connection, owner: PublicKey): Promise<boolean> {
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const ata = getAssociatedTokenAddressSync(new PublicKey(CIRCLE_DEVNET_USDC_MINT), owner);
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

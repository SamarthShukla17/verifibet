"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { NETWORK } from "@/lib/config";
import { WalletUx } from "@/components/providers/WalletUx";

import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProvider({ children }: { children: ReactNode }) {
  const endpoint = NETWORK.rpcUrl;

  // Phantom and Solflare are registered explicitly; Backpack has no dedicated
  // adapter package — it implements the Wallet Standard and is auto-detected
  // by SolanaWalletProvider alongside these.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
          <WalletUx />
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

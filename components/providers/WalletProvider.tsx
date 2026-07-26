"use client";

import { useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { NETWORK } from "@/lib/config";

// Not the package's own `@solana/wallet-adapter-react-ui/styles.css` —
// see components/providers/wallet-adapter.css's own doc comment for why.
import "./wallet-adapter.css";

/** `ssr: false` + dynamic import (not a static `import`): `WalletUx`
 * renders nothing (`return null`) — it's pure post-connect side effects —
 * and pulls in `@solana/spl-token` (~65KB gzipped, see
 * `lib/solana/program.ts`'s doc comment). Deferring it out of the initial
 * bundle costs nothing visually (nothing to hydrate-flash) since every
 * route renders `WalletProvider` at the root. */
const WalletUx = dynamic(() => import("@/components/providers/WalletUx").then((m) => m.WalletUx), {
  ssr: false,
});

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

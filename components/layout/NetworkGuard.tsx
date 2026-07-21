"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { TriangleAlert } from "lucide-react";

const CHECK_INTERVAL_MS = 30_000;
const CHECK_TIMEOUT_MS = 5_000;

/**
 * Amber, non-blocking banner when the configured devnet RPC
 * (`NETWORK.rpcUrl`, via `useConnection()` — the same connection every
 * other on-chain read in the app uses) is slow or unreachable. Polls
 * `getSlot()` — the cheapest real round-trip that actually proves the
 * endpoint is answering, not just that DNS resolves — every 30s, racing
 * it against a 5s timeout so a merely-slow RPC still reads as "unhealthy"
 * rather than hanging the check itself. Renders nothing when healthy;
 * never intercepts clicks or blocks the rest of the page either way —
 * "non-blocking" is the whole point, since a devnet hiccup is exactly the
 * kind of thing a bettor should be able to see and keep browsing through,
 * not get walled off by.
 */
export function NetworkGuard() {
  const { connection } = useConnection();
  const [healthy, setHealthy] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        await Promise.race([
          connection.getSlot(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("RPC check timed out")), CHECK_TIMEOUT_MS)),
        ]);
        if (!cancelled) setHealthy(true);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    }

    void check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection]);

  if (healthy) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-1.5 border-b border-accent-gold/30 bg-accent-gold/10 px-4 py-1.5 text-center text-xs font-medium text-accent-gold"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Devnet RPC is slow or unreachable right now — odds and balances may be stale.
    </div>
  );
}

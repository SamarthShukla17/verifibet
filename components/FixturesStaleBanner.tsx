"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

const POLL_MS = 15_000;

/**
 * Full-width amber strip, shown only while `/api/fixtures` is serving its
 * last-known-good Upstash snapshot instead of a live TxLINE fetch (see
 * `X-Fixtures-Stale` on that route, and `readThroughStaleOnError`'s own
 * doc comment in `lib/cache.ts`) — the honest signal that what's on
 * screen is real data, just not necessarily current, rather than letting
 * a TxLINE/RPC outage either 500 the page or silently show stale numbers
 * with no indication anything's wrong.
 *
 * Polls the same endpoint every consumer on the page already fetches
 * from (cheap — it's cache-backed) rather than piggybacking on any one
 * page's own fetch, so this works identically on every route without
 * threading a prop through each of them. Mounted once, globally, next to
 * `DemoReplayBanner` — see `app/layout.tsx`.
 */
export function FixturesStaleBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/fixtures", { cache: "no-store" });
        if (!cancelled) setStale(res.headers.get("x-fixtures-stale") === "true");
      } catch {
        // A failed fetch here says nothing about fixtures staleness
        // specifically — leave the banner's current state alone rather
        // than guessing.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-accent-gold px-4 py-1.5 text-center text-xs font-medium text-accent-gold-foreground"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Reconnecting to live data — showing the last known fixtures while TxLINE catches up.
    </div>
  );
}

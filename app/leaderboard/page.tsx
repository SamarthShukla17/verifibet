"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { minidenticon } from "minidenticons";
import { useWallet } from "@solana/wallet-adapter-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StreakChip } from "@/components/bet/StreakChip";
import { ExplorerLink } from "@/components/ExplorerLink";
import { formatSignedUsdc, formatUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/app/api/leaderboard/route";

type SortTab = "volume" | "accuracy" | "streak";

const TABS: { value: SortTab; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "accuracy", label: "Accuracy" },
  { value: "streak", label: "🔥 Streak" },
];

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

/** Re-fetched on this same cadence so the page eventually reflects a
 * fresh cache entry without the viewer having to manually reload — the
 * API's own cache (`app/api/leaderboard/route.ts`) is 60s, so anything
 * shorter here would just be re-requesting the same cached response. */
const REFRESH_INTERVAL_MS = 60_000;

function sortForTab(entries: readonly LeaderboardEntry[], tab: SortTab): LeaderboardEntry[] {
  const copy = [...entries];
  if (tab === "volume") {
    return copy.sort((a, b) => {
      const diff = BigInt(b.volume) - BigInt(a.volume);
      return diff === 0n ? a.rank - b.rank : diff > 0n ? 1 : -1;
    });
  }
  if (tab === "accuracy") {
    return copy.sort((a, b) => b.accuracyPct - a.accuracyPct || a.rank - b.rank);
  }
  return copy.sort((a, b) => b.streak - a.streak || a.rank - b.rank);
}

/** SVG identicon from a wallet address — `minidenticon()` is a pure,
 * deterministic function of `seed` (see the `minidenticons` package),
 * rendered as a data-URI `<img>` (the pattern its own README uses)
 * rather than `dangerouslySetInnerHTML`. */
function Identicon({ seed, size = 32 }: { seed: string; size?: number }) {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(minidenticon(seed, 90, 50))}`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className="shrink-0 rounded-md bg-muted"
      style={{ width: size, height: size }}
    />
  );
}

function LeaderboardRow({
  entry,
  isYou,
  highlightTab,
}: {
  entry: LeaderboardEntry;
  isYou: boolean;
  highlightTab: SortTab;
}) {
  const medal = MEDALS[entry.rank];
  const decided = entry.wins + entry.losses;
  const pnl = BigInt(entry.pnl);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3",
        isYou ? "border-primary/60 bg-primary/5" : "border-border bg-card",
      )}
    >
      <div className="w-7 shrink-0 text-center">
        {medal ? (
          <span className="text-lg leading-none">{medal}</span>
        ) : (
          <span className="tabular text-sm font-semibold text-muted-foreground">#{entry.rank}</span>
        )}
      </div>

      <Identicon seed={entry.wallet} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          <ExplorerLink
            kind="account"
            value={entry.wallet}
            display={isYou ? "You" : undefined}
            className="text-foreground hover:text-primary"
          />
        </p>
        <p className="text-xs text-muted-foreground">
          {decided === 0 ? "No decided bets yet" : `${entry.wins}–${entry.losses}`}
        </p>
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Volume</p>
        <p
          className={cn(
            "tabular text-sm font-semibold text-foreground",
            highlightTab === "volume" && "text-primary",
          )}
        >
          {formatUsdc(BigInt(entry.volume), 0)}
        </p>
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Accuracy</p>
        <p
          className={cn(
            "tabular text-sm font-semibold text-foreground",
            highlightTab === "accuracy" && "text-primary",
          )}
        >
          {decided === 0 ? "—" : `${entry.accuracyPct.toFixed(1)}%`}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <StreakChip streak={entry.streak} className={cn(highlightTab !== "streak" && "opacity-70")} />
        {entry.streak <= 0 && <span className="text-xs text-muted-foreground">—</span>}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">P&L</p>
        <p
          className={cn(
            "tabular text-sm font-bold",
            pnl > 0n ? "text-primary" : pnl < 0n ? "text-destructive" : "text-foreground",
          )}
        >
          {formatSignedUsdc(pnl, 0)}
        </p>
      </div>
    </div>
  );
}

/**
 * Every wallet with an on-chain `Bet`, ranked by realized P&L
 * (`app/api/leaderboard/route.ts`, Upstash-cached 60s server-side) —
 * public, read-only data, so unlike `/portfolio` this page never gates
 * on a connected wallet; connecting only adds the "You" pin.
 */
export default function LeaderboardPage() {
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<SortTab>("volume");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const json: { entries?: LeaderboardEntry[] } = await res.json();
        if (cancelled) return;
        if (!Array.isArray(json.entries)) {
          setError(true);
          return;
        }
        setEntries(json.entries);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const myWallet = publicKey?.toBase58() ?? null;
  const myEntry = myWallet && entries ? (entries.find((e) => e.wallet === myWallet) ?? null) : null;
  const sorted = entries ? sortForTab(entries, tab) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every wallet with a real on-chain bet, ranked by realized P&amp;L.
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as SortTab)} className="mt-6">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {myEntry && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your rank</p>
            <LeaderboardRow entry={myEntry} isYou highlightTab={tab} />
          </div>
        )}

        <div className="mt-4 space-y-2">
          {error ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load the leaderboard — try again shortly.
            </div>
          ) : sorted === null ? (
            <>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </>
          ) : sorted.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
              <p className="text-sm text-muted-foreground">No bets placed yet — be the first.</p>
              <Button asChild className="mt-4" variant="secondary">
                <Link href="/matches">Browse Matches</Link>
              </Button>
            </div>
          ) : (
            // The viewer's own row already shows above, pinned — omitted
            // here rather than shown twice back-to-back.
            sorted
              .filter((entry) => entry.wallet !== myWallet)
              .map((entry) => <LeaderboardRow key={entry.wallet} entry={entry} isYou={false} highlightTab={tab} />)
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}

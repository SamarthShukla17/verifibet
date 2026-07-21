"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/layout/WalletButton";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { BalanceChip } from "@/components/layout/BalanceChip";

const NAV_LINKS = [
  { href: "/matches", label: "Matches" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/bets", label: "My Bets" },
];

/**
 * Sticky glass navbar. The wordmark's "V" is a lucide `Check` glyph, not a
 * letter — a checkmark and a capital V are the same basic stroke shape (short
 * downstroke, long upstroke), so swapping one for an emerald check reads as
 * "VERIFIBET" while doubling as the literal mark of on-chain verification the
 * product is built around. `aria-label` carries the real accessible name so
 * the glyph + "ERIFIBET" text underneath can stay purely decorative.
 */
export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="glass sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="VERIFIBET — home"
          className="flex shrink-0 items-center gap-1 font-display text-xl font-bold tracking-tight text-foreground"
        >
          <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={3.5} aria-hidden />
          <span aria-hidden>ERIFIBET</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <BalanceChip />
          <WalletButton />
        </div>
      </div>

      <NetworkGuard />
    </header>
  );
}

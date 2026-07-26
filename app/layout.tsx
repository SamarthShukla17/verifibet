import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { WalletProvider } from "@/components/providers/WalletProvider";
import { Toaster } from "@/components/ui/sonner";
import { DemoReplayBanner } from "@/components/DemoReplayBanner";
import { FixturesStaleBanner } from "@/components/FixturesStaleBanner";
import "./globals.css";

// Body copy — read-heavy UI (market lists, bet history, copy).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// Display — headers and, mandatorily, every odds/amount value (via the
// `.tabular` utility in globals.css). Distinct geometric letterforms and
// true tabular figures are the whole point: odds need to read like a
// trading terminal, not like the surrounding body copy.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

/**
 * `NEXT_PUBLIC_APP_URL` — same env var (and same `http://localhost:3000`
 * local-dev fallback) `keeper/resolver.ts`/`keeper/demoResolver.ts`
 * already use for the exact same "what's this app's own canonical
 * origin" question, not a new convention invented for metadata alone.
 * `metadataBase` is what lets every route's relative-feeling
 * `openGraph`/`twitter` image URLs resolve to absolute ones without each
 * one having to know its own deployment origin — most routes here
 * already build fully-absolute URLs by hand via `lib/baseUrl.ts`
 * (request-header-derived, so it's correct behind any proxy/preview
 * deployment too), so this is mainly a fallback for the file-convention
 * images (`opengraph-image.tsx`, `icon.svg`, ...) Next resolves itself.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "VERIFIBET",
    template: "%s · VERIFIBET",
  },
  description:
    "Solana parimutuel prediction markets for the 2026 World Cup, settled on-chain against TxLINE.",
  openGraph: {
    type: "website",
    siteName: "VERIFIBET",
    title: "VERIFIBET",
    description:
      "Solana parimutuel prediction markets for the 2026 World Cup, settled on-chain against TxLINE.",
  },
  twitter: {
    card: "summary_large_image",
    title: "VERIFIBET",
    description:
      "Solana parimutuel prediction markets for the 2026 World Cup, settled on-chain against TxLINE.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased`}>
        <WalletProvider>{children}</WalletProvider>
        {/* Mounted once, globally — see its own doc comment for why this
            has to be visible in every frame, not opted into per-page. */}
        <DemoReplayBanner />
        {/* Same "visible in every frame, not per-page" reasoning as
            DemoReplayBanner above — a TxLINE/RPC outage can happen on
            any route, not just /matches. */}
        <FixturesStaleBanner />
        {/* top-right — sonner's own fixed corner never overlaps
            BetSlip's fixed bottom-sheet (mobile) or sticky right rail
            (desktop), so toasts (including WalletUx's persistent
            HelpCard) never fight it for space. */}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}

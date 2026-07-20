import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { WalletProvider } from "@/components/providers/WalletProvider";
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

export const metadata: Metadata = {
  title: "VERIFIBET",
  description:
    "Solana parimutuel prediction markets for the 2026 World Cup, settled on-chain against TxLINE.",
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
      </body>
    </html>
  );
}

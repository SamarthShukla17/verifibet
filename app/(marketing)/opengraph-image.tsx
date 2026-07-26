/**
 * The landing page's own OG card — Next's file convention (this file's
 * location, right next to `page.tsx` in the same `(marketing)` route
 * group segment) is what associates it with exactly `/`, not a manual
 * `generateMetadata().openGraph.images` entry. With no separate
 * `twitter-image.tsx` alongside it, Next reuses this same image for the
 * `twitter:image` tag too (documented fallback behavior) — the root
 * layout's `twitter: { card: "summary_large_image" }` (see
 * `app/layout.tsx`) is the only other piece needed for a correct X
 * unfurl.
 */
import { ImageResponse } from "next/og";
import { OG_COLORS as COLORS } from "@/lib/ogColors";
import { loadGoogleFont } from "@/lib/ogFonts";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TAGLINE = "Bet on the World Cup. Verify every settlement.";
const SUBLINE = "Parimutuel markets on all 104 matches — settled by cryptographic proof from TxODDS, not by us.";

export default async function Image() {
  const glyphText = `✓VERIFIBET${TAGLINE}${SUBLINE}Solana·Devnet`;
  const [interBold, interMedium, spaceGroteskBold] = await Promise.all([
    loadGoogleFont("Inter", 700, glyphText),
    loadGoogleFont("Inter", 500, glyphText),
    loadGoogleFont("Space Grotesk", 700, "VERIFIBET"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 64,
          background: COLORS.background,
          color: COLORS.foreground,
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              display: "flex",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: COLORS.primary,
              color: COLORS.primaryForeground,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, fontFamily: "Space Grotesk", letterSpacing: -0.5 }}>
            VERIFIBET
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 52,
            fontWeight: 700,
            textAlign: "center",
            maxWidth: 980,
            lineHeight: 1.25,
          }}
        >
          {TAGLINE}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 26,
            fontWeight: 500,
            color: COLORS.mutedForeground,
            textAlign: "center",
            maxWidth: 820,
            lineHeight: 1.4,
          }}
        >
          {SUBLINE}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 20,
            color: COLORS.mutedForeground,
          }}
        >
          Solana · Devnet
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        ...(interBold ? [{ name: "Inter", data: interBold, weight: 700 as const, style: "normal" as const }] : []),
        ...(interMedium ? [{ name: "Inter", data: interMedium, weight: 500 as const, style: "normal" as const }] : []),
        ...(spaceGroteskBold
          ? [{ name: "Space Grotesk", data: spaceGroteskBold, weight: 700 as const, style: "normal" as const }]
          : []),
      ],
    },
  );
}

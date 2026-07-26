/**
 * GET /api/og/bet — a shareable 1200×630 dark card for one position:
 * flags, "10 USDC on Brazil @ ~2.4x", the wordmark, and the "settled by
 * proof, not promises" footer. `mode=receipt` swaps the multiplier line
 * for a real payout + proof-root snippet, sourced from `lib/receipts.ts`'s
 * `buildReceipt` (Session 6.2) — the same on-chain + TxLINE-proof
 * assembly the Verification tab uses, not a second, less-trustworthy
 * implementation of "what got settled".
 *
 * All display numbers (`amount`, `multiplier`, `payout`) come in via
 * `searchParams`, client-supplied by `ShareButton` from a `Position` it
 * already has — this route never re-derives them from chain state itself
 * (a personal stake/payout has no market-level source of truth to check
 * it against anyway, see `lib/receipts.ts`'s own doc comment on why
 * `Receipt.betAmount`/`payout` are always omitted there). What *is*
 * re-verified here, in `mode=receipt`, is the proof root and whether it
 * actually verified — that's the one part of this card that would be
 * dishonest to just echo back from the query string unchecked.
 *
 * `runtime = "nodejs"`, not the more common `edge` for `next/og` — same
 * reason as every other route here that can end up touching
 * `@coral-xyz/anchor` (`mode=receipt` does, via `buildReceipt`):
 * `edge` can't load it. `ImageResponse` itself works fine under either
 * runtime.
 */
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { buildReceipt, ReceiptNotAvailableError } from "@/lib/receipts";
import { getReadOnlyProgram } from "@/lib/solana/program";
import { flagUrl } from "@/lib/flags";

export const runtime = "nodejs";
// `force-dynamic`, matching every other route.ts here that reads
// per-request data (see app/api/fixtures, app/api/markets/[fixtureId],
// app/api/leaderboard): without it, Next's route-handler static
// optimization can decide this GET has no dynamic dependency (reading
// `request.url` via a manually-constructed `new URL(...)` isn't always
// recognized as request-dependent the way `request.nextUrl` is) and
// cache the *first* response, then serve that exact same image back for
// every other combination of query params after it — silently wrong for
// every card but the one that happened to render first.
export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

const COLORS = {
  background: "hsl(222, 47%, 6%)",
  border: "hsl(222, 30%, 16%)",
  foreground: "hsl(220, 20%, 97%)",
  mutedForeground: "hsl(220, 14%, 60%)",
  primary: "hsl(160, 84%, 39%)",
  primaryForeground: "hsl(222, 47%, 6%)",
  gold: "hsl(43, 96%, 56%)",
} as const;

/**
 * Google Fonts' CSS2 endpoint serves TTF (not WOFF2) to a plain `fetch`
 * with no `Accept` header — Satori (what `ImageResponse` renders with)
 * can only parse TTF/OTF, not WOFF2, which is what a real browser would
 * get from the same URL. `text` scopes the returned subset to only the
 * glyphs this card actually uses, keeping the fetch small. Returns
 * `null` (never throws) on any failure — Satori falls back to its own
 * default font, so a Google Fonts hiccup degrades the card's typography,
 * it doesn't break the image.
 */
async function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl)).text();
    const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
    if (!match) return null;
    return await (await fetch(match[1])).arrayBuffer();
  } catch {
    return null;
  }
}

function formatMoney(raw: string | null, fallback = "0.00"): string {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fallback;
}

/** First 6 + last 6 hex chars — enough to look like a real root at a
 * glance (and to spot-check against the full one on the Verification
 * tab) without the card's headline text overflowing 1200px. */
function shortHex(hex: string): string {
  return hex.length <= 16 ? hex : `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

function FlagCircle({ team, size = 88 }: { team: string; size?: number }) {
  const src = flagUrl(team);
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        border: `3px solid ${COLORS.border}`,
        background: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders its own <img>, not a browser one; next/image doesn't apply here.
        <img src={src} width={size} height={size} style={{ objectFit: "cover" }} alt="" />
      ) : (
        <div style={{ display: "flex", fontSize: size * 0.36, fontWeight: 700, color: COLORS.mutedForeground }}>
          {team.slice(0, 2).toUpperCase()}
        </div>
      )}
    </div>
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") === "receipt" ? "receipt" : "bet";
  const home = searchParams.get("home") ?? "Home";
  const away = searchParams.get("away") ?? "Away";
  const pick = searchParams.get("pick") ?? home;
  const amount = formatMoney(searchParams.get("amount"));

  let payoutText: string | null = null;
  let proofText: string | null = null;
  let verified = false;
  let multiplierText: string | null = null;

  if (mode === "receipt") {
    payoutText = formatMoney(searchParams.get("payout"));
    const fixtureIdParam = searchParams.get("fixtureId");
    const fixtureId = fixtureIdParam ? Number(fixtureIdParam) : NaN;
    if (Number.isInteger(fixtureId) && fixtureId > 0) {
      try {
        const program = await getReadOnlyProgram();
        const receipt = await buildReceipt(program.provider.connection, program, fixtureId);
        proofText = shortHex(receipt.proofRoot);
        verified = receipt.verifiedLocally;
      } catch (err) {
        // A card that can't independently verify still renders — just
        // without a proof snippet — rather than 500ing on a link
        // someone's about to paste into a chat. Real failure modes here
        // (ReceiptNotAvailableError for a not-yet-resolved market, or a
        // genuine RPC hiccup) are both "no proof to show", not "crash".
        if (!(err instanceof ReceiptNotAvailableError)) console.error("[og/bet] receipt lookup failed", err);
      }
    }
  } else {
    const rawMultiplier = searchParams.get("multiplier");
    const n = rawMultiplier ? Number(rawMultiplier) : NaN;
    if (Number.isFinite(n) && n > 0) multiplierText = `~${n.toFixed(1)}x`;
  }

  const glyphText = `✓${amount}${payoutText ?? ""}${proofText ?? ""}${multiplierText ?? ""}USDConVERIFIBETsettledbyproofnotpromisesvsVerified·Devnet${home}${away}${pick}`;
  const [interBold, spaceGroteskBold] = await Promise.all([
    loadGoogleFont("Inter", 700, glyphText),
    loadGoogleFont("Space Grotesk", 700, "VERIFIBET"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: COLORS.background,
          color: COLORS.foreground,
          fontFamily: "Inter",
        }}
      >
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              width: 36,
              height: 36,
              borderRadius: 9,
              background: COLORS.primary,
              color: COLORS.primaryForeground,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, fontFamily: "Space Grotesk", letterSpacing: -0.5 }}>
            VERIFIBET
          </div>
        </div>

        {/* main content */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <FlagCircle team={home} />
            <div style={{ display: "flex", fontSize: 28, color: COLORS.mutedForeground, fontWeight: 600 }}>vs</div>
            <FlagCircle team={away} />
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "baseline",
              gap: 16,
              maxWidth: 1000,
              textAlign: "center",
            }}
          >
            <div style={{ display: "flex", fontSize: 60, fontWeight: 700 }}>{amount} USDC on</div>
            <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: COLORS.primary }}>{pick}</div>
            {multiplierText && (
              <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: COLORS.mutedForeground }}>
                @ {multiplierText}
              </div>
            )}
          </div>

          {mode === "receipt" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginTop: 4,
                padding: "12px 22px",
                borderRadius: 999,
                border: `1px solid ${verified ? COLORS.gold : COLORS.border}`,
                background: "hsl(222, 41%, 9%)",
              }}
            >
              <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: COLORS.gold }}>
                Payout {payoutText} USDC
              </div>
              {proofText && (
                <>
                  <div style={{ display: "flex", fontSize: 24, color: COLORS.mutedForeground }}>·</div>
                  <div style={{ display: "flex", fontSize: 22, color: verified ? COLORS.primary : COLORS.mutedForeground }}>
                    {verified ? "Verified ✓" : "Proof"} {proofText}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ display: "flex", fontSize: 20, color: COLORS.mutedForeground }}>settled by proof, not promises</div>
          <div style={{ display: "flex", fontSize: 20, color: COLORS.mutedForeground }}>Solana · Devnet</div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        ...(interBold ? [{ name: "Inter", data: interBold, weight: 700 as const, style: "normal" as const }] : []),
        ...(spaceGroteskBold
          ? [{ name: "Space Grotesk", data: spaceGroteskBold, weight: 700 as const, style: "normal" as const }]
          : []),
      ],
      // Belt-and-suspenders alongside `dynamic = "force-dynamic"` above —
      // every position's card is a distinct set of query params, so
      // nothing (a CDN in front of this in production, a link-unfurl
      // bot's own fetch cache, an intermediate proxy) should ever treat
      // one of these responses as reusable for a different URL.
      headers: { "Cache-Control": "no-store" },
    },
  );
}

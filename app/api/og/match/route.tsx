/**
 * GET /api/og/match — the *default* card for a bare `/matches/[fixtureId]`
 * link (no `?ref=share` query string): flags, "Home vs Away", stage
 * badge, and whatever's true about the match right now (kickoff time,
 * a live score, or the final score) — no personal bet/stake data at
 * all, unlike `app/api/og/bet/route.tsx`'s cards, which are always about
 * *someone's* specific position. That route stays exactly as it was;
 * this one exists because a bare match link previously had no OG image
 * whatsoever (only a share-triggered visit ever got one) — see
 * `app/matches/[fixtureId]/page.tsx`'s `generateMetadata`, which now
 * falls back to this route whenever the share-specific params aren't
 * present.
 *
 * `runtime = "nodejs"`, matching `app/api/og/bet/route.tsx`'s own
 * reasoning — this route doesn't touch `@coral-xyz/anchor` itself, but
 * staying consistent with the rest of this app's OG routes (all
 * Node-runtime, all `force-dynamic`) is simpler than special-casing the
 * one that happens not to need it.
 */
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { flagUrl } from "@/lib/flags";
import { STAGE_LABELS } from "@/lib/market";
import { OG_COLORS as COLORS } from "@/lib/ogColors";
import { loadGoogleFont } from "@/lib/ogFonts";
import type { FixtureStage, FixtureStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

function FlagCircle({ team, size = 96 }: { team: string; size?: number }) {
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

function isFixtureStage(value: string | null): value is FixtureStage {
  return value !== null && value in STAGE_LABELS;
}

function isFixtureStatus(value: string | null): value is FixtureStatus {
  return value === "SCHEDULED" || value === "LIVE" || value === "FINISHED" || value === "POSTPONED" || value === "CANCELLED";
}

function formatKickoff(kickoffTs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(kickoffTs * 1000));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const home = searchParams.get("home") ?? "Home";
  const away = searchParams.get("away") ?? "Away";
  const stageParam = searchParams.get("stage");
  const stage = isFixtureStage(stageParam) ? stageParam : null;
  const statusParam = searchParams.get("status");
  const status = isFixtureStatus(statusParam) ? statusParam : "SCHEDULED";
  const kickoffTsParam = searchParams.get("kickoffTs");
  const kickoffTs = kickoffTsParam ? Number(kickoffTsParam) : NaN;
  const homeScoreParam = searchParams.get("homeScore");
  const awayScoreParam = searchParams.get("awayScore");
  const homeScore = homeScoreParam !== null ? Number(homeScoreParam) : null;
  const awayScore = awayScoreParam !== null ? Number(awayScoreParam) : null;
  const hasScore = homeScore !== null && awayScore !== null && Number.isFinite(homeScore) && Number.isFinite(awayScore);

  const stageLabel = stage ? STAGE_LABELS[stage] : "World Cup 2026";

  let statusLine: string;
  if (status === "LIVE" && hasScore) statusLine = `LIVE  ${homeScore}–${awayScore}`;
  else if (status === "FINISHED" && hasScore) statusLine = `Full-time  ${homeScore}–${awayScore}`;
  else if (Number.isFinite(kickoffTs)) statusLine = formatKickoff(kickoffTs);
  else statusLine = "Kickoff TBD";

  const glyphText = `✓VERIFIBETPariMutuelmarketsettledbyproofnotpromisesvsSolana·Devnet${home}${away}${stageLabel}${statusLine}0123456789–:LIVEFull-time`;
  const [interBold, interSemibold, spaceGroteskBold] = await Promise.all([
    loadGoogleFont("Inter", 700, glyphText),
    loadGoogleFont("Inter", 600, glyphText),
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 600,
              color: COLORS.mutedForeground,
              padding: "8px 18px",
              borderRadius: 999,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            {stageLabel}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <FlagCircle team={home} />
              <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>{home}</div>
            </div>
            <div style={{ display: "flex", fontSize: 32, color: COLORS.mutedForeground, fontWeight: 600 }}>vs</div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <FlagCircle team={away} />
              <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>{away}</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: status === "LIVE" ? 40 : 26,
              fontWeight: 700,
              color: status === "LIVE" ? COLORS.primary : COLORS.mutedForeground,
            }}
          >
            {statusLine}
          </div>
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
        ...(interSemibold ? [{ name: "Inter", data: interSemibold, weight: 600 as const, style: "normal" as const }] : []),
        ...(spaceGroteskBold
          ? [{ name: "Space Grotesk", data: spaceGroteskBold, weight: 700 as const, style: "normal" as const }]
          : []),
      ],
      // Same reasoning as app/api/og/bet/route.tsx: every fixture is a
      // distinct set of query params, nothing upstream should cache one
      // fixture's card and serve it back for a different one.
      headers: { "Cache-Control": "no-store" },
    },
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MatchDetailBoard } from "@/components/match/MatchDetailBoard";
import { STAGE_LABELS } from "@/lib/market";
import { getBaseUrl } from "@/lib/baseUrl";
import { getStatusTracker, type TrackedFixture } from "@/lib/txline/statusTracker";

interface PageParams {
  fixtureId: string;
}

type PageSearchParams = { [key: string]: string | string[] | undefined };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function getFixture(fixtureIdParam: string): Promise<TrackedFixture | null> {
  const fixtureId = Number(fixtureIdParam);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) return null;

  // Reads the shared `StatusTracker` singleton directly rather than
  // self-fetching `/api/fixtures` over HTTP — see
  // app/matches/(list)/page.tsx's identical fix for why (a real production
  // crash, not a theoretical one).
  const tracker = await getStatusTracker();
  return tracker.list().find((f) => f.fixtureId === fixtureId) ?? null;
}

/**
 * `?ref=share&pick=...&amount=...&mode=...&payout=...&multiplier=...` —
 * `ShareButton`'s own query contract (see that component's doc comment).
 * `home`/`away` are deliberately never read from `searchParams` here —
 * this function already has the fixture's real team names from
 * `getFixture`, which is the authoritative source a share link shouldn't
 * need to (and, for an unrecognized/spoofed value, shouldn't) override.
 */
function buildOgImageUrl(fixture: TrackedFixture, searchParams: PageSearchParams): string | null {
  if (firstParam(searchParams.ref) !== "share") return null;

  const params = new URLSearchParams();
  params.set("fixtureId", String(fixture.fixtureId));
  params.set("home", fixture.home);
  params.set("away", fixture.away);

  const pick = firstParam(searchParams.pick);
  if (pick) params.set("pick", pick);
  const amount = firstParam(searchParams.amount);
  if (amount) params.set("amount", amount);

  if (firstParam(searchParams.mode) === "receipt") {
    params.set("mode", "receipt");
    const payout = firstParam(searchParams.payout);
    if (payout) params.set("payout", payout);
  } else {
    const multiplier = firstParam(searchParams.multiplier);
    if (multiplier) params.set("multiplier", multiplier);
  }

  return `${getBaseUrl()}/api/og/bet?${params.toString()}`;
}

/**
 * The default (non-share) card — always available, since it only ever
 * needs data `getFixture` already fetched, unlike `buildOgImageUrl`
 * above (which needs `ShareButton`-supplied query params that only
 * exist on a share link). Passes the fixture's live score through when
 * `status` is `LIVE`/`FINISHED` so a link shared *during* a match shows
 * the real score, not just "kickoff at ...".
 */
function buildDefaultMatchOgUrl(fixture: TrackedFixture): string {
  const params = new URLSearchParams({
    home: fixture.home,
    away: fixture.away,
    stage: fixture.stage,
    status: fixture.status,
    kickoffTs: String(fixture.kickoffTs),
  });
  if (fixture.score) {
    params.set("homeScore", String(fixture.score.home));
    params.set("awayScore", String(fixture.score.away));
  }
  return `${getBaseUrl()}/api/og/match?${params.toString()}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const { fixtureId } = await params;
  const fixture = await getFixture(fixtureId);

  if (!fixture) {
    return { title: "Match not found" };
  }

  // Bare — the root layout's `title.template` ("%s · VERIFIBET") adds
  // the brand suffix for the actual `<title>` tag. `openGraph`/`twitter`
  // titles don't get that template applied automatically (Next only
  // resolves it for the top-level `metadata.title`), so those use
  // `socialTitle` below instead, built the same way by hand.
  const title = `${fixture.home} vs ${fixture.away}`;
  const socialTitle = `${title} · VERIFIBET`;
  const description = `${STAGE_LABELS[fixture.stage]} — parimutuel odds and on-chain settlement for ${fixture.home} vs ${fixture.away}, verified via TxODDS TxLINE.`;

  // A share-triggered visit (`?ref=share&pick=...`) gets that specific
  // bet's own card; every other visit — including the very first time
  // anyone pastes a bare match link anywhere — still gets a real,
  // fixture-specific preview instead of no image at all. See
  // `app/api/og/match/route.tsx`'s own doc comment on why this is a
  // separate route from `buildOgImageUrl`'s `/api/og/bet`, not a
  // no-params fallback mode on that same one.
  const ogImageUrl = buildOgImageUrl(fixture, await searchParams) ?? buildDefaultMatchOgUrl(fixture);
  const images = [{ url: ogImageUrl, width: 1200, height: 630 }];

  return {
    title,
    description,
    openGraph: { title: socialTitle, description, images },
    twitter: { card: "summary_large_image", title: socialTitle, description, images: [ogImageUrl] },
  };
}

export default async function MatchDetailPage({ params }: { params: Promise<PageParams> }) {
  const { fixtureId } = await params;
  const fixture = await getFixture(fixtureId);

  if (!fixture) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <MatchDetailBoard
          fixtureId={fixture.fixtureId}
          home={fixture.home}
          away={fixture.away}
          stage={fixture.stage}
          group={fixture.group}
          kickoffTs={fixture.kickoffTs}
          status={fixture.status}
          initialScore={fixture.score}
        />
      </div>

      <Footer />

      {/* Same mobile BetSlip / footer overlap fix as app/matches/(list) —
       * see that layout's own doc comment for the full reasoning. */}
      <div aria-hidden className="h-[26rem] lg:hidden" />
    </div>
  );
}

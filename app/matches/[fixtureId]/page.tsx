import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MatchDetailBoard } from "@/components/match/MatchDetailBoard";
import { STAGE_LABELS } from "@/lib/market";
import { getBaseUrl } from "@/lib/baseUrl";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

interface PageParams {
  fixtureId: string;
}

async function getFixture(fixtureIdParam: string): Promise<TrackedFixture | null> {
  const fixtureId = Number(fixtureIdParam);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) return null;

  // Same fetch (same URL + revalidate window) app/matches/(list)/page.tsx
  // makes — Next's fetch cache/request memoization means this doesn't
  // re-fetch the whole tournament list a second time within the window,
  // it just filters the already-cached result down to one fixture.
  const res = await fetch(`${getBaseUrl()}/api/fixtures`, { next: { revalidate: 30 } });
  const fixtures: TrackedFixture[] = await res.json();
  return fixtures.find((f) => f.fixtureId === fixtureId) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { fixtureId } = await params;
  const fixture = await getFixture(fixtureId);

  if (!fixture) {
    return { title: "Match not found — VERIFIBET" };
  }

  const title = `${fixture.home} vs ${fixture.away} — VERIFIBET`;
  const description = `${STAGE_LABELS[fixture.stage]} — parimutuel odds and on-chain settlement for ${fixture.home} vs ${fixture.away}, verified via TxODDS TxLINE.`;

  return {
    title,
    description,
    openGraph: { title, description },
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

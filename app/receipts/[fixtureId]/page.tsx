import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProofPanel } from "@/components/verification/ProofPanel";
import { ReceiptHero } from "@/components/receipts/ReceiptHero";
import { ReceiptShareBar } from "@/components/receipts/ReceiptShareBar";
import { PersonalPositionStrip } from "@/components/receipts/PersonalPositionStrip";
import { ReceiptTimeline } from "@/components/receipts/ReceiptTimeline";
import { buildReceipt, ReceiptNotAvailableError } from "@/lib/receipts";
import { buildMarketTimeline } from "@/lib/solana/timeline";
import { getReadOnlyProgram } from "@/lib/solana/program";
import { getBaseUrl } from "@/lib/baseUrl";
import { STAGE_LABELS } from "@/lib/market";
import { usdcToInputValue } from "@/lib/format";
import type { Receipt } from "@/lib/types";
import type { TrackedFixture } from "@/lib/txline/statusTracker";

interface PageParams {
  fixtureId: string;
}

function parseFixtureId(param: string): number | null {
  const fixtureId = Number(param);
  return Number.isInteger(fixtureId) && fixtureId > 0 ? fixtureId : null;
}

async function loadReceipt(fixtureId: number): Promise<Receipt> {
  const program = await getReadOnlyProgram();
  return buildReceipt(program.provider.connection, program, fixtureId);
}

/** Best-effort only — a receipt is fully assembled from on-chain +
 * TxLINE-proof data regardless of whether this succeeds; `stage` is
 * purely a hero-copy nicety (`Market` itself has no `stage` field). */
async function loadStage(fixtureId: number): Promise<string | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/fixtures`, { next: { revalidate: 60 } });
    const fixtures: TrackedFixture[] = await res.json();
    const fixture = fixtures.find((f) => f.fixtureId === fixtureId);
    return fixture ? STAGE_LABELS[fixture.stage] : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { fixtureId: fixtureIdParam } = await params;
  const fixtureId = parseFixtureId(fixtureIdParam);
  if (fixtureId === null) return { title: "Receipt not found" };

  let receipt: Receipt;
  try {
    receipt = await loadReceipt(fixtureId);
  } catch {
    return { title: "Receipt not yet available" };
  }

  // Bare — see app/matches/[fixtureId]/page.tsx's own comment on why:
  // the root layout's `title.template` adds "· VERIFIBET" to the actual
  // `<title>` tag; `socialTitle` below does the same by hand for
  // `openGraph`/`twitter`, which don't get the template automatically.
  const title = `${receipt.teams.home} ${receipt.finalScore.home}–${receipt.finalScore.away} ${receipt.teams.away} — Verified Receipt`;
  const socialTitle = `${title} · VERIFIBET`;
  const description = receipt.attested
    ? "Demo scenario — resolved by authority attestation, not independently verified against TxODDS TxLINE."
    : "Settled on-chain and independently verifiable against TxODDS TxLINE — every proof checkable by anyone, not just us.";

  // The aggregate, non-personal framing (see this route's own doc
  // comment on why "mode=receipt" needs an amount/payout at all): the
  // winning side's own total stake, and the total pool it collectively
  // pays out to — both real, both true regardless of who any one
  // visitor is.
  const winningPool = receipt.pools[receipt.outcome];
  const ogParams = new URLSearchParams({
    mode: "receipt",
    fixtureId: String(fixtureId),
    home: receipt.teams.home,
    away: receipt.teams.away,
    pick: receipt.outcome === 1 ? "Draw" : receipt.outcome === 0 ? receipt.teams.home : receipt.teams.away,
    amount: usdcToInputValue(BigInt(winningPool)),
    payout: usdcToInputValue(BigInt(receipt.totalPool)),
  });
  const ogImageUrl = `${getBaseUrl()}/api/og/bet?${ogParams.toString()}`;
  const images = [{ url: ogImageUrl, width: 1200, height: 630 }];

  return {
    title,
    description,
    openGraph: { title: socialTitle, description, images },
    twitter: { card: "summary_large_image", title: socialTitle, description, images: [ogImageUrl] },
  };
}

function NotSettledYet({ reason }: { reason: "no_market" | "not_resolved" }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="font-display text-base font-semibold text-foreground">
            {reason === "no_market" ? "No market yet for this fixture." : "Not settled yet."}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {reason === "no_market"
              ? "This fixture doesn't have an on-chain market synced yet — there's nothing to show a receipt for."
              : "This match hasn't been resolved on-chain yet. The verified settlement receipt appears here the moment it is."}
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}

/**
 * The public artifact this product is named for: a resolved market's
 * settlement, made fully legible and independently checkable, at a
 * stable URL that needs no wallet and no app state to read — a judge (or
 * anyone) opening this cold, logged out, gets the complete story:
 * what happened, what the on-chain proof says, and exactly when/how it
 * was settled. `PersonalPositionStrip` is the one piece that adapts to
 * whoever's actually viewing (their own connected wallet, if any) —
 * everything else on this page is identical for every visitor.
 */
export default async function ReceiptPage({ params }: { params: Promise<PageParams> }) {
  const { fixtureId: fixtureIdParam } = await params;
  const fixtureId = parseFixtureId(fixtureIdParam);
  if (fixtureId === null) notFound();

  let receipt: Receipt;
  try {
    receipt = await loadReceipt(fixtureId);
  } catch (err) {
    if (err instanceof ReceiptNotAvailableError) {
      return <NotSettledYet reason={err.reason} />;
    }
    throw err;
  }

  const [stage, timeline] = await Promise.all([loadStage(fixtureId), buildMarketTimeline(fixtureId)]);
  const canonicalUrl = `${getBaseUrl()}/receipts/${fixtureId}`;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <ReceiptHero receipt={receipt} stage={stage} />

        <div className="flex justify-center">
          <ReceiptShareBar url={canonicalUrl} receipt={receipt} />
        </div>

        <PersonalPositionStrip fixtureId={fixtureId} />

        <ProofPanel receipt={receipt} />

        <ReceiptTimeline receipt={receipt} timeline={timeline} />
      </div>

      <Footer />
    </div>
  );
}

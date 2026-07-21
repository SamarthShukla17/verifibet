import Link from "next/link";
import { ArrowDown, Lock, ShieldCheck, Trophy } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { MatchCard } from "@/components/market/MatchCard";
import { BracketView } from "@/components/BracketView";
import { getStatusTracker, type TrackedFixture } from "@/lib/txline/statusTracker";
import { marketStatusFromFixtureStatus } from "@/lib/market";

/**
 * "Today's" fixtures by literal same-UTC-calendar-day kickoff, falling
 * back to the fixtures chronologically nearest `now` when nothing kicks
 * off today — this dataset's compressed demo tournament window won't
 * always straddle the real clock's current day, and an honestly-labeled
 * "recent & upcoming" strip beats a strip that's silently empty.
 */
function pickLiveStripFixtures(fixtures: TrackedFixture[]): {
  fixtures: TrackedFixture[];
  label: string;
} {
  const now = Date.now();
  const nowDate = new Date(now);
  const isSameUtcDay = (kickoffTs: number) => {
    const d = new Date(kickoffTs * 1000);
    return (
      d.getUTCFullYear() === nowDate.getUTCFullYear() &&
      d.getUTCMonth() === nowDate.getUTCMonth() &&
      d.getUTCDate() === nowDate.getUTCDate()
    );
  };

  const today = fixtures.filter((f) => isSameUtcDay(f.kickoffTs)).sort((a, b) => a.kickoffTs - b.kickoffTs);
  if (today.length > 0) return { fixtures: today, label: "Today's Matches" };

  const nearest = [...fixtures]
    .sort((a, b) => Math.abs(a.kickoffTs * 1000 - now) - Math.abs(b.kickoffTs * 1000 - now))
    .slice(0, 8);
  return { fixtures: nearest, label: "Recent & Upcoming Matches" };
}

const STEPS = [
  {
    icon: Lock,
    title: "Escrowed on-chain",
    body: "Your USDC moves straight into the market's on-chain pool the moment you bet — no custodian, no IOU.",
  },
  {
    icon: Trophy,
    title: "Match ends",
    body: "TxODDS's TxLINE feed reports the final result the instant the match is finalized.",
  },
  {
    icon: ShieldCheck,
    title: "TxLINE proof settles it",
    body: "The program verifies a cryptographic proof of that result on-chain before a single payout moves — settlement nobody, including us, can fake.",
  },
];

export default async function MarketingPage() {
  const tracker = await getStatusTracker();
  const fixtures = tracker.list();
  const liveStrip = pickLiveStripFixtures(fixtures);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="text-balance font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl md:text-6xl">
          Bet on the World Cup. <span className="text-primary">Verify every settlement.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          Parimutuel markets on all 104 matches. USDC escrowed on Solana. Settled by cryptographic
          proof from TxODDS — not by us.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="glow-emerald w-full sm:w-auto">
            <Link href="/matches">Browse Matches</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <a href="#how-it-works" className="inline-flex items-center gap-1.5">
              How verification works
              <ArrowDown className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        </div>
      </section>

      {/* Live strip */}
      {liveStrip.fixtures.length > 0 && (
        <section className="border-t border-border bg-card/30 py-10">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <h2 className="mb-4 font-display text-lg font-semibold text-foreground">
              {liveStrip.label}
            </h2>
            <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
              {liveStrip.fixtures.map((fixture) => (
                <div key={fixture.fixtureId} className="w-72 shrink-0 snap-start sm:w-80">
                  <MatchCard
                    fixture={fixture}
                    odds={null}
                    marketStatus={marketStatusFromFixtureStatus(fixture.status)}
                    live={
                      fixture.status === "LIVE" ? { minute: fixture.score?.minute } : null
                    }
                    totalPoolBaseUnits={0n}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Knockout bracket */}
      <section className="border-t border-border py-12">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <h2 className="mb-1 font-display text-2xl font-semibold text-foreground">
            Knockout Bracket
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Round of 16 through the Final, straight from TxLINE — unplayed rounds show the
            official match numbers of the games that feed them.
          </p>
          <BracketView fixtures={fixtures} />
        </div>
      </section>

      {/* How verification works */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-border bg-card/30 py-14">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <h2 className="mb-10 text-center font-display text-2xl font-semibold text-foreground sm:text-3xl">
            How verification works
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="relative flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                  <step.icon className="h-6 w-6" aria-hidden />
                </div>
                <p className="mt-4 font-display text-base font-semibold text-foreground">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                {i < STEPS.length - 1 && (
                  <div
                    className="absolute right-[-1rem] top-7 hidden h-px w-8 bg-border sm:block"
                    aria-hidden
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

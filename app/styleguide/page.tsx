import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The design system, rendered — every token, the type scale, and every
 * component state in one place. This page is b-roll for the demo video's
 * tech segment, so it's deliberately more built-out than a real internal
 * styleguide needs to be: it has to look good on camera, not just be
 * technically complete.
 */

interface Swatch {
  name: string;
  varName: string;
  hsl: string;
  className: string;
  fgClassName?: string;
  note: string;
}

const SURFACE_SWATCHES: Swatch[] = [
  { name: "Background", varName: "--background", hsl: "222 47% 6%", className: "bg-background", note: "Page canvas — near-black navy." },
  { name: "Card", varName: "--card", hsl: "222 41% 9%", className: "bg-card", note: "Raised surfaces — market cards, panels." },
  { name: "Popover", varName: "--popover", hsl: "222 41% 9%", className: "bg-popover", note: "Dropdowns, modals." },
  { name: "Secondary", varName: "--secondary", hsl: "222 25% 14%", className: "bg-secondary", note: "Subdued fills." },
  { name: "Muted", varName: "--muted", hsl: "222 25% 12%", className: "bg-muted", note: "Quiet backgrounds." },
  { name: "Border", varName: "--border", hsl: "222 30% 16%", className: "bg-border", note: "Every hairline in the app." },
];

const SEMANTIC_SWATCHES: Swatch[] = [
  { name: "Primary — Emerald", varName: "--primary", hsl: "160 84% 39%", className: "bg-primary", fgClassName: "text-primary-foreground", note: "Success, CTAs, on-brand focus." },
  { name: "Destructive — Ruby", varName: "--destructive", hsl: "350 89% 60%", className: "bg-destructive", fgClassName: "text-destructive-foreground", note: "Losses, live indicators, danger." },
  { name: "Accent Gold", varName: "--accent-gold", hsl: "43 96% 56%", className: "bg-accent-gold", fgClassName: "text-accent-gold-foreground", note: "Winners, streaks, highlights." },
  { name: "Accent (hover surface)", varName: "--accent", hsl: "160 30% 14%", className: "bg-accent", fgClassName: "text-accent-foreground", note: "Ghost-button / row hover wash." },
];

const TEXT_SWATCHES: Swatch[] = [
  { name: "Foreground", varName: "--foreground", hsl: "220 20% 97%", className: "bg-foreground", note: "Primary text." },
  { name: "Muted foreground", varName: "--muted-foreground", hsl: "220 14% 60%", className: "bg-muted-foreground", note: "Secondary/caption text." },
];

function ColorSwatch({ swatch }: { swatch: Swatch }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        className={`flex h-20 items-end p-3 ${swatch.className} ${swatch.fgClassName ?? ""}`}
      >
        <span className="font-display text-xs font-semibold uppercase tracking-wider opacity-80">
          Aa
        </span>
      </div>
      <div className="space-y-0.5 bg-card p-3">
        <p className="text-sm font-medium text-foreground">{swatch.name}</p>
        <p className="tabular text-xs text-muted-foreground">
          {swatch.varName}: {swatch.hsl}
        </p>
        <p className="text-xs text-muted-foreground">{swatch.note}</p>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6 space-y-1">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </p>
      <h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-8 py-16">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-primary">
            VERIFIBET
          </p>
          <h1 className="mt-3 font-display text-5xl font-bold tracking-tight text-foreground">
            Design tokens
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Dark-only sportsbook — Vercel/Linear restraint, ESPN energy.
            One perfect dark theme, no switcher.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-20 px-8 py-16">
        {/* Colors */}
        <section>
          <SectionHeading
            eyebrow="01 — Color"
            title="Surfaces"
            description="Four levels of near-black navy, from page canvas up to raised panels — plus the hairline border that separates them."
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {SURFACE_SWATCHES.map((s) => (
              <ColorSwatch key={s.varName} swatch={s} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading
            eyebrow="01 — Color"
            title="Semantic accents"
            description="Emerald for success and calls to action, ruby for losses and live indicators, gold reserved for winners and streaks. Every accent pairs with a near-black foreground — checked against WCAG contrast math, not the usual white-on-color default."
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {SEMANTIC_SWATCHES.map((s) => (
              <ColorSwatch key={s.varName} swatch={s} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="01 — Color" title="Text" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {TEXT_SWATCHES.map((s) => (
              <ColorSwatch key={s.varName} swatch={s} />
            ))}
          </div>
        </section>

        {/* Type scale */}
        <section>
          <SectionHeading
            eyebrow="02 — Type"
            title="Type scale"
            description="Space Grotesk for display and every numeric value; Inter for body copy. Odds and amounts always carry .tabular — fixed-width figures, so a column of live numbers never jitters as digits change."
          />
          <div className="space-y-6 rounded-lg border border-border bg-card p-8">
            <div className="space-y-3">
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Display / Space Grotesk
              </p>
              <p className="font-display text-6xl font-bold text-foreground">Aa 0123</p>
              <p className="font-display text-4xl font-bold text-foreground">Aa 0123</p>
              <p className="font-display text-2xl font-semibold text-foreground">Aa 0123</p>
              <p className="font-display text-lg font-medium text-foreground">Aa 0123</p>
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-3">
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Body / Inter
              </p>
              <p className="text-xl text-foreground">
                The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-base text-foreground">
                The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-sm text-muted-foreground">
                The quick brown fox jumps over the lazy dog.
              </p>
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-2">
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                .tabular — odds ticker
              </p>
              <div className="flex flex-wrap gap-6">
                <span className="tabular text-4xl font-bold text-primary">1.953</span>
                <span className="tabular text-4xl font-bold text-foreground">3.400</span>
                <span className="tabular text-4xl font-bold text-destructive">4.180</span>
                <span className="tabular text-4xl font-bold text-accent-gold">112,500.00</span>
              </div>
            </div>
          </div>
        </section>

        {/* Buttons */}
        <section>
          <SectionHeading eyebrow="03 — Components" title="Buttons" />
          <div className="space-y-6 rounded-lg border border-border bg-card p-8">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Default</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="default">Default size</Button>
              <Button size="lg">Large</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>Disabled</Button>
              <Button variant="destructive" disabled>
                Disabled destructive
              </Button>
              <Button className="glow-emerald">Glowing CTA</Button>
            </div>
          </div>
        </section>

        {/* Badges */}
        <section>
          <SectionHeading eyebrow="03 — Components" title="Badges" />
          <div className="space-y-6 rounded-lg border border-border bg-card p-8">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
            <div className="h-px bg-border" />
            <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sportsbook semantics
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                LIVE
              </span>
              <span className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                OPEN
              </span>
              <span className="inline-flex items-center rounded-full bg-accent-gold/15 px-3 py-1 text-xs font-semibold text-accent-gold">
                WON
              </span>
              <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                SETTLED
              </span>
            </div>
          </div>
        </section>

        {/* Utility classes */}
        <section>
          <SectionHeading
            eyebrow="04 — Utilities"
            title="Glass & glow"
            description=".glass for floating panels over content; .glow-emerald for CTA/live emphasis."
          />
          <div className="relative overflow-hidden rounded-lg border border-border">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--primary)/0.35),transparent_50%),radial-gradient(ellipse_at_bottom_right,hsl(var(--accent-gold)/0.3),transparent_50%)] bg-background" />
            <div className="relative grid grid-cols-1 gap-6 p-10 sm:grid-cols-2">
              <div className="glass rounded-lg p-6">
                <p className="font-display text-sm font-semibold text-foreground">.glass</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Frosted panel — readable over any background, without
                  fully hiding it.
                </p>
              </div>
              <div className="glow-emerald flex items-center justify-center rounded-lg bg-card p-6">
                <p className="font-display text-sm font-semibold text-primary">
                  .glow-emerald
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Card in context */}
        <section>
          <SectionHeading eyebrow="03 — Components" title="Card" />
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="font-display">Spain vs Argentina</CardTitle>
              <CardDescription>World Cup Final · Full-time result</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Home win</span>
              <span className="tabular text-2xl font-bold text-primary">1.953</span>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

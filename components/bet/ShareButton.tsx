"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { formatUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Position } from "@/lib/hooks/useMyBets";

export interface ShareButtonProps {
  position: Position;
  className?: string;
}

/**
 * `/matches/[fixtureId]?ref=share&...` — `fixtureId` is the only thing
 * that lives in the path; everything else is query params the OG route
 * (`app/api/og/bet/route.tsx`) and the match page's own `generateMetadata`
 * both read. `home`/`away` are deliberately *not* included here — the
 * match page already knows its own fixture's real team names once it
 * loads them server-side, so there's no reason to trust (or even carry)
 * a client-supplied copy of something the destination page can source
 * authoritatively itself.
 *
 * `won`/`claimed` positions share as `mode=receipt` (a real payout +
 * proof-root snippet, once the OG route independently re-verifies it —
 * see that route's own doc comment) — every other status shares as the
 * plain "stake on pick @ multiplier" card, using whichever of
 * `estPayout`/`payout` the position actually has for the multiplier.
 */
function buildShareUrl(position: Position): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams();
  params.set("ref", "share");
  params.set("pick", position.pickLabel);
  params.set("amount", (Number(position.amount) / 1_000_000).toFixed(2));

  if ((position.status === "won" || position.status === "claimed") && position.payout !== null) {
    params.set("mode", "receipt");
    params.set("payout", (Number(position.payout) / 1_000_000).toFixed(2));
  } else {
    const denominator = position.estPayout ?? position.payout;
    if (denominator !== null && position.amount > 0n) {
      params.set("multiplier", (Number(denominator) / Number(position.amount)).toFixed(1));
    }
  }

  return `${origin}/matches/${position.fixtureId}?${params.toString()}`;
}

function shareText(position: Position): string {
  return `${formatUsdc(position.amount)} USDC on ${position.pickLabel} — settled by proof, not promises.`;
}

/**
 * Mobile gets the OS's own native share sheet (`navigator.share`, which
 * already includes "share to X" among whatever else is installed);
 * desktop — where `navigator.share` is far less commonly supported —
 * falls back to copying the link, with a dedicated X-intent button right
 * next to it so that specific target isn't buried behind a share sheet
 * that doesn't exist there. Both buttons are always rendered rather than
 * conditionally swapped: `navigator.share` support is a real per-browser
 * feature check at click time, not something worth guessing from screen
 * width ahead of time.
 */
export function ShareButton({ position, className }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = buildShareUrl(position);
    const text = shareText(position);

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "VERIFIBET", text, url });
      } catch {
        // User closed the native share sheet — not an error worth a toast.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  function handleXIntent() {
    const url = buildShareUrl(position);
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(position))}&url=${encodeURIComponent(url)}`;
    window.open(intentUrl, "_blank", "noreferrer");
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => void handleShare()}
        title="Share"
        aria-label="Share this position"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Share2 className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={handleXIntent}
        title="Share on X"
        aria-label="Share this position on X"
        className="rounded-md px-1.5 py-1 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        𝕏
      </button>
    </div>
  );
}

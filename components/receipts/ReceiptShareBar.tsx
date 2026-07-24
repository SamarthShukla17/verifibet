"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openXIntent, shareOrCopy } from "@/lib/share";
import type { Receipt } from "@/lib/types";

export interface ReceiptShareBarProps {
  /** This receipt page's own canonical URL — not a per-position share
   * link (that's `ShareButton.tsx`'s job). */
  url: string;
  receipt: Receipt;
}

function shareText(receipt: Receipt): string {
  return `${receipt.teams.home} ${receipt.finalScore.home}–${receipt.finalScore.away} ${receipt.teams.away} — settled by proof, not promises.`;
}

/** Copy-link + share for the receipt page itself — same mobile/desktop
 * mechanics as `ShareButton.tsx` (`lib/share.ts`), just sharing this
 * page's own URL instead of a personal position's. */
export function ReceiptShareBar({ url, receipt }: ReceiptShareBarProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const result = await shareOrCopy({ url, text: shareText(receipt), title: "VERIFIBET Receipt" });
    if (result === "copied") {
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } else if (result === "error") {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => void handleShare()}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
        <span className="ml-1.5">{copied ? "Copied" : "Copy link"}</span>
      </Button>
      <Button variant="secondary" size="sm" onClick={() => openXIntent({ url, text: shareText(receipt) })}>
        Share on 𝕏
      </Button>
    </div>
  );
}

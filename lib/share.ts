/**
 * The actual mobile/desktop share mechanics — `navigator.share` when the
 * browser genuinely exposes it (checked at call time, not guessed from
 * screen width), clipboard copy otherwise, and a standalone X-intent
 * opener for the dedicated desktop button. Extracted once a second real
 * call site (`components/receipts/ReceiptShareBar.tsx`) needed the exact
 * same mechanics `components/bet/ShareButton.tsx` already had — only
 * *what* URL/text to share differs per call site (a `Position`'s own
 * share link vs. a receipt page's own canonical URL), never *how*.
 */

export type ShareResult = "shared" | "copied" | "error";

export interface ShareInput {
  url: string;
  text: string;
  title?: string;
}

/** Never throws — a user closing the native share sheet resolves as
 * `"shared"` (they didn't do anything wrong), and a clipboard failure
 * resolves as `"error"` for the caller to toast instead of throwing. */
export async function shareOrCopy({ url, text, title }: ShareInput): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: title ?? "VERIFIBET", text, url });
    } catch {
      // User closed the native share sheet — not an error worth surfacing.
    }
    return "shared";
  }

  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "error";
  }
}

export function openXIntent({ url, text }: Pick<ShareInput, "url" | "text">): void {
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(intentUrl, "_blank", "noreferrer");
}

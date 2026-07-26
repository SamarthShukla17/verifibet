"use client";

import { ErrorState } from "@/components/ErrorState";

/**
 * No `Navbar`/`Footer` here — `app/matches/(list)/layout.tsx` renders
 * them around `{children}`, and this boundary only replaces `{children}`
 * (the layout itself stays mounted), so re-adding them would duplicate
 * the chrome.
 */
export default function MatchesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title="Couldn't load matches"
      description="Something went wrong fetching the match list. Try again — if it keeps happening, the issue is likely on our end, not yours."
    />
  );
}

"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorStateProps {
  /** Next's `error.tsx` boundary props, passed straight through — see
   * https://nextjs.org/docs/app/api-reference/file-conventions/error.
   * `digest` (when present) is a server-side error hash safe to show a
   * user for support purposes; the message itself is not — Next strips
   * it in production builds for anything thrown server-side. */
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}

/**
 * Shared body for every route's `error.tsx` — styled consistently with
 * this app's dark theme rather than Next's default plain-text fallback,
 * with a real retry affordance (`reset()`, which re-renders the segment
 * without a full page reload). Routes with their own `layout.tsx`
 * (`/matches`) render just this; routes without one re-wrap it in
 * `Navbar`/`Footer` themselves so the chrome doesn't disappear when the
 * boundary trips.
 */
export function ErrorState({ error, reset, title = "Something went wrong", description }: ErrorStateProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {description ?? "An unexpected error occurred. Try again — if it keeps happening, the issue is likely on our end, not yours."}
        </p>
        {error.digest && (
          <p className="pt-1 font-mono text-[11px] text-muted-foreground/60">ref: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset} variant="secondary" size="sm">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Try again
      </Button>
    </div>
  );
}

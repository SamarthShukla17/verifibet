"use client";

/**
 * The last-resort boundary — catches anything that escapes every nested
 * `error.tsx` (or a crash in the root layout itself). Per Next's own
 * convention for a *root* `error.tsx` specifically (unlike every nested
 * one), this has to render its own `<html>`/`<body>` — there's no parent
 * layout left above it to supply them. Deliberately minimal: no
 * `WalletProvider`, no fonts, no `ErrorState` import — if the crash
 * originated in one of those, re-rendering it here would just crash
 * again instead of recovering.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center font-sans text-foreground">
        <p className="text-lg font-semibold">Something went wrong</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          VERIFIBET hit an unexpected error. Try again — if it keeps happening, the issue is likely
          on our end, not yours.
        </p>
        {error.digest && <p className="font-mono text-[11px] text-muted-foreground/60">ref: {error.digest}</p>}
        <button
          onClick={reset}
          className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Try again
        </button>
      </body>
    </html>
  );
}

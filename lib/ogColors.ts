/**
 * The one shared palette every generated image in this app draws
 * from — `app/api/og/bet/route.tsx` (the original), `app/(marketing)/
 * opengraph-image.tsx`, `app/api/og/match/route.tsx`, and
 * `app/apple-icon.tsx`/`app/icon.svg` (those two inline the two colors
 * that matter for a tiny mark rather than importing this — a `.ts`
 * module isn't usable from a static `.svg` file anyway). Centralized so
 * a future brand-color change updates every generated card and icon
 * together instead of drifting one file at a time.
 */
export const OG_COLORS = {
  background: "hsl(222, 47%, 6%)",
  border: "hsl(222, 30%, 16%)",
  foreground: "hsl(220, 20%, 97%)",
  mutedForeground: "hsl(220, 14%, 60%)",
  primary: "hsl(160, 84%, 39%)",
  primaryForeground: "hsl(222, 47%, 6%)",
  gold: "hsl(43, 96%, 56%)",
} as const;

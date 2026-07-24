import { redirect } from "next/navigation";

/**
 * Superseded by `app/portfolio/page.tsx` (stat cards, Active/Settled/All
 * tabs, Claim All — this route was the plain list-only version). Kept as
 * a redirect rather than deleted outright so an old bookmark/link to
 * `/bets` — the Navbar's own "My Bets" link pointed here until this same
 * change — still lands somewhere real instead of 404ing.
 */
export default function BetsPageRedirect() {
  redirect("/portfolio");
}

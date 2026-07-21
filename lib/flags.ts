/**
 * Team name -> ISO 3166-1 alpha-2 (or, for the UK home nations, the
 * circle-flags-specific `gb-xxx` subdivision code) -> circle-flags CDN
 * URL. Purely cosmetic (a flag icon next to a team name) — never a
 * source of truth for anything the app actually settles or transacts on
 * (that's TxLINE's `Participant1`/`Participant2` strings and the
 * on-chain `Market.home`/`away` fields, both handled entirely
 * independently of this file), so `flagUrl` degrades gracefully
 * (`null`) for an unrecognized name instead of throwing.
 *
 * The 48-team roster and each team's real confederation are the actual,
 * confirmed 2026 FIFA World Cup field (verified via a live search against
 * fifa.com at the time this was written — see NOTES.md — not recalled
 * from memory, since several qualification playoffs were still pending
 * as of this project's knowledge cutoff). Several teams get more than one
 * key because the *name string* a real data source uses varies by
 * source/convention, and this map needs to match whichever one actually
 * shows up:
 *
 * - `"Cape Verde"` (TxLINE's own spelling, confirmed in real captured
 *   fixture data) alongside FIFA's official `"Cabo Verde"`.
 * - `"Congo DR"` (TxLINE's real spelling) alongside `"DR Congo"` (the
 *   task's own named special case — a different word order).
 * - `"Bosnia & Herzegovina"` (TxLINE's real spelling, with an ampersand)
 *   alongside the spelled-out `"Bosnia and Herzegovina"`.
 * - `"Ivory Coast"` (TxLINE's real spelling) alongside FIFA's official
 *   `"Côte d'Ivoire"`.
 * - `"Türkiye"` (FIFA's official spelling, with the correct diacritic)
 *   alongside the plain-ASCII `"Turkey"`.
 * - A handful of others with common colloquial alternates likely to show
 *   up in some data source (`"South Korea"` for `"Korea Republic"`,
 *   `"Iran"` for `"IR Iran"`, `"USA"`/`"United States"` both ways).
 *
 * circle-flags (github.com/HatScripts/circle-flags) is the only place
 * that ships the UK's home nations (England, Scotland) as distinct flags
 * under their own codes (`gb-eng`, `gb-sct`) rather than one shared `gb`
 * — confirmed by fetching both URLs directly, not assumed from the
 * project's README.
 */

const CIRCLE_FLAGS_BASE = "https://hatscripts.github.io/circle-flags/flags";

const TEAM_ISO: Record<string, string> = {
  // Co-hosts
  Canada: "ca",
  Mexico: "mx",
  USA: "us",
  "United States": "us",

  // AFC
  Australia: "au",
  Iraq: "iq",
  "IR Iran": "ir",
  Iran: "ir",
  Japan: "jp",
  Jordan: "jo",
  "Korea Republic": "kr",
  "South Korea": "kr",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Uzbekistan: "uz",

  // CAF
  Algeria: "dz",
  "Cabo Verde": "cv",
  "Cape Verde": "cv",
  "Congo DR": "cd",
  "DR Congo": "cd",
  "Côte d'Ivoire": "ci",
  "Ivory Coast": "ci",
  Egypt: "eg",
  Ghana: "gh",
  Morocco: "ma",
  Senegal: "sn",
  "South Africa": "za",
  Tunisia: "tn",

  // Concacaf (non-host)
  Curaçao: "cw",
  Curacao: "cw",
  Haiti: "ht",
  Panama: "pa",

  // CONMEBOL
  Argentina: "ar",
  Brazil: "br",
  Colombia: "co",
  Ecuador: "ec",
  Paraguay: "py",
  Uruguay: "uy",

  // OFC
  "New Zealand": "nz",

  // UEFA
  Austria: "at",
  Belgium: "be",
  "Bosnia & Herzegovina": "ba",
  "Bosnia and Herzegovina": "ba",
  Croatia: "hr",
  Czechia: "cz",
  "Czech Republic": "cz",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Netherlands: "nl",
  Norway: "no",
  Portugal: "pt",
  Scotland: "gb-sct",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Türkiye: "tr",
  Turkey: "tr",
};

/** The circle-flags SVG URL for a team name, or `null` if unrecognized —
 * never throws, so an unmapped/unexpected name (a demo-data typo, a
 * future non-World-Cup competition) just means no flag renders, not a
 * crashed page. */
export function flagUrl(teamName: string): string | null {
  const code = TEAM_ISO[teamName];
  return code ? `${CIRCLE_FLAGS_BASE}/${code}.svg` : null;
}

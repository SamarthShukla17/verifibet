/**
 * Fetches a real TxLINE Merkle proof for one finished fixture's
 * FT_RESULT and prints it as a box-drawing ASCII tree — this exact
 * output is what appears in the demo video's tech segment, so the
 * rendering in `renderTree` below is deliberately more elaborate than a
 * one-off CLI tool would normally warrant.
 *
 * Usage: pnpm tsx scripts/fetch-proof.ts <fixtureId>
 */
import { existsSync } from "node:fs";
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

import { fetchProof, type NormalizedProof } from "@/lib/txline/proofs";
import type { ProofStep } from "@/lib/txline/verify";
import { getFixtures } from "@/lib/txline/client";

const TOURNAMENT_START_EPOCH_DAY = 20_632; // see scripts/sync-markets.ts

async function lookupTeams(fixtureId: number): Promise<{ home: string; away: string } | null> {
  try {
    const fixtures = await getFixtures({
      competition: 72,
      from: TOURNAMENT_START_EPOCH_DAY * 86_400,
    });
    const match = fixtures.find((f) => f.FixtureId === fixtureId);
    if (!match) return null;
    return match.Participant1IsHome
      ? { home: match.Participant1, away: match.Participant2 }
      : { home: match.Participant2, away: match.Participant1 };
  } catch {
    return null; // display-only lookup — never let this fail the whole script
  }
}

function truncateHash(hex: string, head = 12, tail = 8): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function siblingLines(nodes: ProofStep[], indent: string): string[] {
  return nodes.map(
    (n, i) =>
      `${indent}${i === nodes.length - 1 ? "└─" : "├─"} ${truncateHash(n.hash)} ${n.isRightSibling ? "▸ right" : "◂ left "}`,
  );
}

function box(lines: string[], width: number): string[] {
  const top = `┌${"─".repeat(width - 2)}┐`;
  const bottom = `└${"─".repeat(width - 2)}┘`;
  const body = lines.map((l) => `│ ${l.padEnd(width - 4)} │`);
  return [top, ...body, bottom];
}

function centered(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}

const WIDTH = 74;

function renderTree(proof: NormalizedProof, teams: { home: string; away: string } | null): string {
  const lines: string[] = [];
  const teamsLabel = teams ? `${teams.home} vs ${teams.away}` : `fixture ${proof.fixtureId}`;
  const resultLabel = teams
    ? `${teams.home} ${proof.meta.home.value} – ${proof.meta.away.value} ${teams.away}`
    : `home ${proof.meta.home.value} – ${proof.meta.away.value} away`;

  lines.push(`╔${"═".repeat(WIDTH - 2)}╗`);
  lines.push(`║${centered("VERIFIBET — TxLINE Merkle Proof", WIDTH - 2)}║`);
  lines.push(`╠${"═".repeat(WIDTH - 2)}╣`);
  lines.push(`║ ${`Fixture   ${proof.fixtureId}  ·  ${teamsLabel}`.padEnd(WIDTH - 4)} ║`);
  lines.push(`║ ${`Result    ${proof.statKind}  ·  ${resultLabel}`.padEnd(WIDTH - 4)} ║`);
  lines.push(
    `║ ${`Event     seq ${proof.meta.seq}  ·  period ${proof.meta.period} (full-time)`.padEnd(WIDTH - 4)} ║`,
  );
  lines.push(`╚${"═".repeat(WIDTH - 2)}╝`);
  lines.push("");

  // Two leaves side by side.
  const leafWidth = Math.floor((WIDTH - 4) / 2);
  const homeLeaf = box(
    [
      `LEAF (home)`,
      `key ${proof.meta.home.statKey}  value ${proof.meta.home.value}  period ${proof.meta.period}`,
      truncateHash(proof.meta.home.leaf, 16, 12),
    ],
    leafWidth,
  );
  const awayLeaf = box(
    [
      `LEAF (away)`,
      `key ${proof.meta.away.statKey}  value ${proof.meta.away.value}  period ${proof.meta.period}`,
      truncateHash(proof.meta.away.leaf, 16, 12),
    ],
    leafWidth,
  );
  for (let i = 0; i < homeLeaf.length; i++) {
    lines.push(`  ${homeLeaf[i].padEnd(leafWidth)}    ${awayLeaf[i]}`);
  }

  lines.push(`  ${"│".padEnd(leafWidth)}    │`);
  lines.push(`  ${`+ ${proof.meta.proof.stat.length} sibling(s):`.padEnd(leafWidth)}    + ${proof.meta.proof.stat2.length} sibling(s):`);
  const maxSib = Math.max(proof.meta.proof.stat.length, proof.meta.proof.stat2.length);
  const homeSibLines = siblingLines(proof.meta.proof.stat, "  ");
  const awaySibLines = siblingLines(proof.meta.proof.stat2, "  ");
  for (let i = 0; i < maxSib; i++) {
    lines.push(`  ${(homeSibLines[i] ?? "").padEnd(leafWidth)}    ${awaySibLines[i] ?? ""}`);
  }
  lines.push(`  ${"▼".padEnd(leafWidth)}    ▼`);
  lines.push("");

  lines.push(centered("╌╌╌╌╌╌╌╌╌╌╌╌ eventStatRoot (shared) ╌╌╌╌╌╌╌╌╌╌╌╌", WIDTH));
  lines.push(centered(truncateHash(proof.meta.eventStatRoot, 16, 12), WIDTH));
  lines.push(centered("│", WIDTH));
  lines.push(centered(`+ ${proof.meta.proof.subTree.length} sibling(s)`, WIDTH));
  for (const l of siblingLines(proof.meta.proof.subTree, "")) lines.push(centered(l.trim(), WIDTH));
  lines.push(centered("▼", WIDTH));
  lines.push("");

  lines.push(centered("eventStatsSubTreeRoot  ══ ROOT ══", WIDTH));
  lines.push(centered(truncateHash(proof.root, 16, 12), WIDTH));
  lines.push(centered("│", WIDTH));
  lines.push(centered(`+ ${proof.meta.proof.mainTree.length} sibling(s)`, WIDTH));
  for (const l of siblingLines(proof.meta.proof.mainTree, "")) lines.push(centered(l.trim(), WIDTH));
  lines.push(centered("▼", WIDTH));
  lines.push("");

  lines.push(centered("⋱ daily_scores_roots PDA (on-chain) ⋰", WIDTH));
  lines.push(centered("verified for real by TxLINE's deployed validate_stat program", WIDTH));
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const fixtureId = Number(process.argv[2]);
  if (!Number.isInteger(fixtureId)) {
    console.error("Usage: pnpm tsx scripts/fetch-proof.ts <fixtureId>");
    process.exit(1);
  }

  const [proof, teams] = await Promise.all([fetchProof(fixtureId), lookupTeams(fixtureId)]);
  console.log(renderTree(proof, teams));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

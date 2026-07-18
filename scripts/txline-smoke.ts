/**
 * Proves authenticated TxLINE data access end to end and captures real
 * response payloads for schema derivation (lib/txline/types.ts).
 *
 * Usage: pnpm tsx scripts/txline-smoke.ts
 * Requires TXLINE_JWT / TXLINE_API_TOKEN in .env.local — run
 * `pnpm txline:subscribe` then `pnpm txline:activate` first.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

import { txlineFetch, TxlineApiError } from "@/lib/txline/http";

const WORLD_CUP_COMPETITION_ID = 72; // confirmed empirically, see NOTES.md

// The fixtures snapshot endpoint defaults `startEpochDay` to the real
// wall-clock "current day UTC", which excludes the already-kicked-off
// Round-of-16 fixtures this script needs — pass it explicitly instead.
// 20639 = 2026-07-05 UTC (epochDay = floor(unixSeconds / 86400)).
const START_EPOCH_DAY = 20639;

const ESCALATION_MESSAGE = `
Could not get real TxLINE devnet fixture data. Ask in t.me/TxLINEChat:

"Hi TxLINE team — devnet fixtures smoke test for VERIFIBET (hackathon
program 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J, wallet
ULxBcwf4vqyT2UtZzGNamBCai7vnMAbpMkBA5BeF7e6). GET /api/fixtures/snapshot
?competitionId=72&startEpochDay=20639 against
https://txline-dev.txodds.com with a valid activated JWT + API token
returned no World Cup fixtures / an error (see attached response below).
Is World Cup fixture data currently populated on devnet for July 2026
dates? Is competitionId=72 still correct for World Cup on devnet? Any
known outage on txline-dev.txodds.com right now?"

Attach the exact error/response printed above this message.
`.trim();

function sampleJsonPath(name: string): string {
  return join(process.cwd(), name);
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await txlineFetch(path);
  return (await response.json()) as T;
}

async function main() {
  console.log(
    `GET /api/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}&startEpochDay=${START_EPOCH_DAY}`,
  );
  const fixtures = await fetchJson<any[]>(
    `/api/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}&startEpochDay=${START_EPOCH_DAY}`,
  );

  writeFileSync(
    sampleJsonPath("fixtures.sample.json"),
    JSON.stringify(fixtures, null, 2) + "\n",
  );
  console.log(`Saved ${fixtures.length} fixtures to fixtures.sample.json`);

  if (fixtures.length === 0) {
    console.error(ESCALATION_MESSAGE);
    process.exit(1);
  }

  const knockout = [...fixtures].sort((a, b) => a.StartTime - b.StartTime);
  const next5 = knockout.slice(0, 5);

  console.log("\nNext 5 knockout-stage fixtures:");
  for (const f of next5) {
    console.log(
      `  ${f.FixtureId}  ${f.Participant1} vs ${f.Participant2}  ${new Date(f.StartTime).toISOString()}`,
    );
  }

  const probeFixtureId = next5[0].FixtureId as number;

  console.log(`\nGET /api/odds/snapshot/${probeFixtureId}`);
  const odds = await fetchJson<any[]>(`/api/odds/snapshot/${probeFixtureId}`);
  writeFileSync(
    sampleJsonPath("odds.sample.json"),
    JSON.stringify(odds, null, 2) + "\n",
  );
  console.log(`Saved ${odds.length} odds entries to odds.sample.json`);

  console.log(`GET /api/scores/snapshot/${probeFixtureId}`);
  const scores = await fetchJson<any[]>(
    `/api/scores/snapshot/${probeFixtureId}`,
  );
  writeFileSync(
    sampleJsonPath("scores.sample.json"),
    JSON.stringify(scores, null, 2) + "\n",
  );
  console.log(`Saved ${scores.length} score entries to scores.sample.json`);
}

main().catch((err) => {
  if (err instanceof TxlineApiError) {
    console.error(`[txline] HTTP ${err.status} — response body: ${err.body}`);
  } else {
    console.error(err);
  }
  console.error(ESCALATION_MESSAGE);
  process.exit(1);
});

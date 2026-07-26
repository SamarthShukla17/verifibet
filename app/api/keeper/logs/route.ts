/**
 * GET /api/keeper/logs?limit= — the keeper dashboard's (`app/keeper/page.tsx`)
 * recent-actions table + 24h success/failure sparkline data. Reads
 * `keeper/logs.ndjson`'s tail directly when this process can see it on
 * disk (local dev, running against the same machine the keeper was last
 * run on) — falls back to `lib/keeperLogs.ts`'s Upstash mirror otherwise,
 * the real production shape: there's no hosted keeper (2026-07-26 deploy —
 * see that file's doc comment), so the deployed Vercel Next server never
 * has filesystem access to whichever operator machine last ran
 * `pnpm keeper`/`pnpm keeper:resolve`.
 *
 * A raw ndjson line is a *job attempt* (table/sparkline-worthy) only if it
 * carries a `job` field and isn't marked `progress: true` — `keeper/resolver.ts`'s
 * feed-flicker poll loop logs several lines per attempt under the same
 * `job`/`fixtureId` (poll status, a transient network retry) that aren't
 * themselves an action; `progress: true` on those is what lets this route
 * tell the two apart structurally instead of matching message strings.
 */
import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRecentKeeperLogLines } from "@/lib/keeperLogs";

export const runtime = "nodejs";

interface RawKeeperLogLine {
  level: number;
  time: number;
  job?: string;
  fixtureId?: number;
  txSig?: string;
  action?: string;
  error?: string;
  progress?: boolean;
  msg?: string;
}

export interface KeeperLogEntry {
  time: number;
  level: number;
  job: string;
  fixtureId?: number;
  txSig?: string;
  action?: string;
  error?: string;
  msg: string;
  outcome: "success" | "failure";
}

export interface SparklineBucket {
  bucketStart: number;
  success: number;
  failure: number;
}

const LOG_PATH = join(process.cwd(), "keeper", "logs.ndjson");
/** Read generously past the table's own display `limit` so the 24h
 * sparkline has real history to bucket from, not just the handful of rows
 * the table itself shows. */
const READ_LINES = 3000;

const SPARKLINE_WINDOW_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 30 * 60 * 1000; // 30-minute buckets, 48 across 24h
const NUM_BUCKETS = SPARKLINE_WINDOW_MS / BUCKET_MS;

/** Newest-first, matching `readRecentKeeperLogLines`'s order (both code
 * paths below feed the same downstream logic either way). */
function tailLocalFile(maxLines: number): string[] {
  if (!existsSync(LOG_PATH)) return [];
  const content = readFileSync(LOG_PATH, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  return lines.slice(-maxLines).reverse();
}

function parseLine(line: string): RawKeeperLogLine | null {
  try {
    return JSON.parse(line) as RawKeeperLogLine;
  } catch {
    return null;
  }
}

/** pino level 30 = info, 40 = warn, 50 = error/fatal. Every non-progress
 * `job` entry at info level represents something that actually completed
 * (`resolved`/`locked`/`skipped`/`dry_run` — `skipped` is a deliberate
 * idempotent no-op, not a problem); warn/error under a `job` field is
 * always a real failure (a retry, a give-up, a validation failure, a
 * dumped simulation). */
function classify(entry: RawKeeperLogLine): "success" | "failure" {
  return entry.level >= 40 ? "failure" : "success";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);

  let lines = tailLocalFile(READ_LINES);
  if (lines.length === 0) {
    lines = await readRecentKeeperLogLines(READ_LINES);
  }

  const jobEntries: KeeperLogEntry[] = [];
  for (const line of lines) {
    const raw = parseLine(line);
    if (!raw || !raw.job || raw.progress) continue;
    jobEntries.push({
      time: raw.time,
      level: raw.level,
      job: raw.job,
      fixtureId: raw.fixtureId,
      txSig: raw.txSig,
      action: raw.action,
      error: raw.error,
      msg: raw.msg ?? "",
      outcome: classify(raw),
    });
  }

  const now = Date.now();
  const buckets: SparklineBucket[] = Array.from({ length: NUM_BUCKETS }, (_, i) => ({
    bucketStart: now - SPARKLINE_WINDOW_MS + i * BUCKET_MS,
    success: 0,
    failure: 0,
  }));

  for (const entry of jobEntries) {
    const age = now - entry.time;
    if (age < 0 || age > SPARKLINE_WINDOW_MS) continue;
    const bucketIndex = NUM_BUCKETS - 1 - Math.floor(age / BUCKET_MS);
    if (bucketIndex < 0 || bucketIndex >= NUM_BUCKETS) continue;
    buckets[bucketIndex][entry.outcome] += 1;
  }

  return NextResponse.json({
    entries: jobEntries.slice(0, limit),
    sparkline: buckets,
  });
}

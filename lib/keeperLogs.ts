/**
 * Redis-backed mirror of `keeper/logs.ndjson`. There's no hosted keeper
 * process (2026-07-26 deploy: resolution runs through the manual backfill
 * CLI, `pnpm keeper:resolve --fixture <id>`, not a daemon — see
 * `app/api/stream/route.ts`'s doc comment) — the keeper only ever runs on
 * whoever's local machine invokes `pnpm keeper`/`pnpm keeper:resolve`, and
 * the deployed Vercel Next server has no filesystem access to that
 * machine's local ndjson file. So `keeper/logger.ts` pushes every log line
 * here too (alongside stdout and the local file), and
 * `app/api/keeper/logs/route.ts` reads them back from here whenever the
 * local file isn't available. Transparently no-ops when Upstash isn't
 * configured — same convention as `lib/cache.ts`.
 */
import { Redis } from "@upstash/redis";

const KEEPER_LOGS_KEY = "keeper:logs";
/** Caps the list so it never grows unbounded — generous for a 24h
 * sparkline at the keeper's real activity cadence (60s tick + a handful
 * of job attempts per tick, worst case). */
const MAX_ENTRIES = 2000;

let redisClient: Redis | null | undefined; // undefined = not yet resolved; null = resolved to no-op mode

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisClient = null;
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

/** Fire-and-forget from `keeper/logger.ts`'s pino stream — never throws,
 * never blocks a log write on a Redis round-trip. */
export async function pushKeeperLogLine(line: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.lpush(KEEPER_LOGS_KEY, line);
    await redis.ltrim(KEEPER_LOGS_KEY, 0, MAX_ENTRIES - 1);
  } catch (err) {
    console.warn("[keeperLogs] push failed", err);
  }
}

/**
 * Newest-first (the order `lpush` naturally produces). Returns `[]` — not
 * an error — whenever Upstash isn't configured or the read fails; the API
 * route falls back to the local ndjson file in that case. The Upstash SDK
 * auto-deserializes any list member that parses as JSON, so a pushed
 * ndjson line can come back as an object instead of the original string —
 * normalized back to a string either way, since every caller here parses
 * it as JSON itself right after.
 */
export async function readRecentKeeperLogLines(limit: number): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.lrange<string | Record<string, unknown>>(KEEPER_LOGS_KEY, 0, limit - 1);
    return raw.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  } catch (err) {
    console.warn("[keeperLogs] read failed", err);
    return [];
  }
}

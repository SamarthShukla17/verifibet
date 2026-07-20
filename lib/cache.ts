/**
 * Read-through Redis cache (`@upstash/redis`) for TxLINE REST responses.
 * `lib/txline/client.ts`'s `getFixtures`/`getOdds`/`getValidationProof`
 * route through `readThrough` internally — this isn't a new API callers
 * opt into, it's a transparent layer under the existing one. Server-only
 * by the same convention as the rest of `lib/txline/*` (no `server-only`
 * package, so CLI scripts can still import through it via `tsx`).
 *
 * **Transparently no-ops when Upstash isn't configured**: if
 * `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't set (the
 * default local-dev state — both exist as empty placeholders in
 * `.env.local`/`.env.local.example`), every `readThrough` call just
 * invokes `fetcher` directly. Callers never need to know or care which
 * mode they're in — same return value, same behavior, just with or
 * without caching.
 *
 * ## TTL policy, one per real volatility, not a single default
 *
 * - `fixtures:all` — `FIXTURES_TTL_SECONDS` (60s). TxLINE's fixtures
 *   snapshot (kickoff times, team names, coarse `GameState`) doesn't
 *   change faster than that in practice.
 * - `odds:<fixtureId>` — `ODDS_TTL_SECONDS` (20s). The fastest-moving
 *   thing cached here. Not a TxLINE-imposed number — devnet's SL1 has no
 *   sampling delay at all (`samplingIntervalSec: 0`, see CLAUDE.md) — 20s
 *   is this cache's own conservative choice, picked to stay well under
 *   any plausible real odds-refresh cadence without going so short the
 *   cache barely helps.
 * - `proof:<fixtureId>:<seq>:<statKey>:<statKey2>` — no TTL
 *   (`PROOF_TTL_SECONDS = null`). A Merkle proof for one specific
 *   `(fixtureId, seq, statKey[, statKey2])` tuple is intrinsically
 *   immutable — TxLINE's daily Merkle roots don't change retroactively —
 *   so once fetched it's cached forever. Keyed on the *full* tuple, not
 *   just `fixtureId` (unlike the task's literal `proof:<id>` shorthand):
 *   `getValidationProof`'s real signature is `(fixtureId, seq, statKey,
 *   statKey2?)` (see `lib/txline/client.ts` — TxLINE's endpoint requires
 *   `seq` to identify *which* scores event to prove, discovered in an
 *   earlier session), and a single fixture has many distinct proofs
 *   (one per scores event/stat). Caching under bare `fixtureId` would
 *   silently return the wrong stat's proof for a second request against
 *   the same fixture.
 *
 * **`getScores` is never wrapped, deliberately.** Live match state is
 * exactly the kind of data `lib/txline/stream.ts`'s SSE pipeline exists
 * to keep fresh in real time — caching it here, even briefly, would
 * quietly reintroduce the staleness that pipeline exists to avoid.
 */
import { Redis } from "@upstash/redis";

export const FIXTURES_TTL_SECONDS = 60;
export const ODDS_TTL_SECONDS = 20;
/** `null` means no expiry — see the module doc comment on `proof:*`. */
export const PROOF_TTL_SECONDS = null;

let redisClient: Redis | null | undefined; // undefined = not yet resolved; null = resolved to no-op mode

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn("[cache] UPSTASH_REDIS_REST_URL/TOKEN not set — caching disabled (no-op), every call hits TxLINE directly");
    redisClient = null;
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

/**
 * Returns the cached value at `key` on a hit; otherwise calls `fetcher`,
 * caches its result (`ttlSeconds: null` = no expiry), and returns it.
 * Falls straight through to `fetcher` — no error, no caching, identical
 * return value — when Redis isn't configured at all, or when a Redis
 * call itself fails (a transient Upstash outage shouldn't take the app
 * down; it should just mean this particular call wasn't cached).
 */
export async function readThrough<T>(
  key: string,
  ttlSeconds: number | null,
  fetcher: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  if (!redis) return fetcher();

  try {
    const cached = await redis.get<T>(key);
    if (cached !== null && cached !== undefined) return cached;
  } catch (err) {
    console.warn(`[cache] GET ${key} failed, falling through to a live fetch`, err);
  }

  const fresh = await fetcher();

  try {
    if (ttlSeconds === null) await redis.set(key, fresh);
    else await redis.set(key, fresh, { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[cache] SET ${key} failed — result still returned, just not cached`, err);
  }

  return fresh;
}

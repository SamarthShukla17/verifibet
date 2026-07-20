/**
 * The single REST gateway to TxLINE's off-chain API — every TxLINE data
 * fetch in this app goes through one of the four functions below, never
 * through `txlineFetch` directly. Server-only by the same convention as
 * `lib/txline/http.ts` (no `server-only` package, so the `scripts/txline-*.ts`
 * CLI scripts can still import this via `tsx`) — never import from a client
 * component.
 *
 * **Service Level 1 delay**: mainnet's free tier samples on a 60-second
 * interval (`pricing_matrix.samplingIntervalSec = 60`); devnet's does not
 * (`samplingIntervalSec = 0`, confirmed on-chain — see CLAUDE.md). Neither
 * this module nor its callers compensate for that delay in any way — it's
 * purely a property of when TxLINE itself refreshes its data. Any UI copy
 * about it ("delayed feed (free tier)") belongs in the frontend, not here.
 */
import { txlineFetch, TxlineApiError } from "@/lib/txline/http";
import type {
  TxFixture,
  TxOdds,
  TxScore,
  TxScoresStatValidation,
} from "@/lib/txline/types";
import {
  TxFixturesSchema,
  TxOddsListSchema,
  TxScoresSchema,
  TxScoresStatValidationSchema,
} from "@/lib/txline/schemas";
import type { z } from "zod";

const ONE_DAY_SECONDS = 86_400;

/**
 * 3 total attempts, 500ms then 2s between them — only for 5xx responses or
 * a network-level failure (fetch throwing before any response arrives).
 * Never retries a 4xx: those are the caller's fault (bad params, expired
 * auth) and retrying won't change the outcome.
 */
const RETRY_DELAYS_MS = [500, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TxlineApiError) return err.status >= 500;
  return true;
}

async function fetchWithRetry(path: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await txlineFetch(path);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(err)) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Parses `data` against `schema`. A mismatch throws in dev (fail fast on a
 * schema drift while it's still cheap to fix) but only warns and passes
 * the raw payload through in prod (best-effort — a live demo shouldn't go
 * blank because TxLINE added a field), matching this module's UI-facing
 * risk tolerance rather than the on-chain program's (which never trades
 * correctness for uptime).
 */
function parsePayload<S extends z.ZodType>(
  schema: S,
  data: unknown,
  context: string,
): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const message = `[txline] ${context}: response failed schema validation — ${result.error.message}`;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(message);
  }
  console.warn(message);
  return data as z.infer<S>;
}

export interface GetFixturesParams {
  /** TxLINE `competitionId` — 72 is the World Cup (confirmed empirically, see NOTES.md). */
  competition?: number;
  /**
   * Unix seconds. Converted to TxLINE's `startEpochDay` (`floor(from / 86400)`).
   * Omitting it defaults to the real wall-clock current day UTC, not any
   * in-story tournament date (see CLAUDE.md).
   */
  from?: number;
  /**
   * Unix seconds. The real endpoint has no end-of-range query param — it
   * always returns fixtures "at or within 30 days after" `from` — so this
   * is applied as a client-side filter on the returned `StartTime` (which
   * TxLINE reports in **milliseconds**, unlike this parameter).
   */
  to?: number;
}

/** GET /api/fixtures/snapshot?competitionId=&startEpochDay= */
export async function getFixtures(
  params: GetFixturesParams = {},
): Promise<TxFixture[]> {
  const query = new URLSearchParams();
  if (params.competition !== undefined) {
    query.set("competitionId", String(params.competition));
  }
  if (params.from !== undefined) {
    query.set(
      "startEpochDay",
      String(Math.floor(params.from / ONE_DAY_SECONDS)),
    );
  }

  const response = await fetchWithRetry(
    `/api/fixtures/snapshot${query.size > 0 ? `?${query}` : ""}`,
  );
  const fixtures = parsePayload(
    TxFixturesSchema,
    await response.json(),
    "getFixtures",
  );

  if (params.to === undefined) return fixtures;
  const toMs = params.to * 1000;
  return fixtures.filter((f) => f.StartTime <= toMs);
}

/**
 * GET /api/odds/snapshot/{fixtureId}
 *
 * Only returns data "within the current 5-minute interval" — an empty
 * array for a fixture with no recent odds activity is a normal, real
 * result, not a failure (confirmed against a decided fixture; see
 * odds.sample.json / NOTES.md).
 */
export async function getOdds(fixtureId: number): Promise<TxOdds[]> {
  const response = await fetchWithRetry(`/api/odds/snapshot/${fixtureId}`);
  return parsePayload(TxOddsListSchema, await response.json(), "getOdds");
}

/**
 * GET /api/scores/snapshot/{fixtureId}
 *
 * Returns every logged `Action` event for the fixture — comment, goal,
 * substitution, lineups, var, game_finalised, ... (see types.ts).
 */
export async function getScores(fixtureId: number): Promise<TxScore[]> {
  const response = await fetchWithRetry(`/api/scores/snapshot/${fixtureId}`);
  return parsePayload(TxScoresSchema, await response.json(), "getScores");
}

/**
 * GET /api/scores/stat-validation (legacy mode) — the Merkle proof chain
 * for one or two score stats on a specific scores-snapshot event, needed
 * to CPI into TxLINE's on-chain `validate_stat` (see
 * `anchor/programs/verifibet/src/instructions/resolve_market.rs`). Not
 * documented in CLAUDE.md/NOTES.md — found by fetching TxLINE's live
 * OpenAPI spec (`https://txline-dev.txodds.com/docs/docs.yaml`) directly,
 * since none of the three data endpoints already documented there expose
 * proof data.
 *
 * Deliberately `(fixtureId, seq, statKey, statKey2?)`, not the originally
 * specified `(fixtureId, statKind)` — the real endpoint also requires
 * `seq` (the scores event's sequence number within the fixture's history;
 * see `TxScore.Seq`) to identify *which* scores-snapshot event to prove
 * stats from. There's no way to build a working request without it.
 * `statKey2` is optional, matching `resolve_market`'s two-`StatTerm`
 * (home/away goals) shape.
 */
export async function getValidationProof(
  fixtureId: number,
  seq: number,
  statKey: number,
  statKey2?: number,
): Promise<TxScoresStatValidation> {
  const query = new URLSearchParams({
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKey: String(statKey),
  });
  if (statKey2 !== undefined) query.set("statKey2", String(statKey2));

  const response = await fetchWithRetry(`/api/scores/stat-validation?${query}`);
  return parsePayload(
    TxScoresStatValidationSchema,
    await response.json(),
    "getValidationProof",
  );
}

export { TxlineApiError };

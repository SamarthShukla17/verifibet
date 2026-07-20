/**
 * TxLINE live pipeline: [TxLINE SSE] -> server singleton consumer (this
 * module) -> in-memory pub/sub -> `app/api/stream/route.ts` (per-browser
 * SSE fan-out) -> `lib/hooks/useLiveFixture.ts` (browser `EventSource`).
 * Server-only by the same convention as the rest of `lib/txline/*` (no
 * `server-only` package, so CLI scripts can still import it via `tsx`) —
 * never import runtime code from here into a client component (types are
 * fine, e.g. `useLiveFixture.ts`'s `import type { RawStatusEvent }`).
 *
 * **Production topology (not this dev setup)**: the singleton consumer
 * below (the two long-lived upstream TxLINE connections) and the keeper
 * are meant to run as one persistent Railway process (see Session 8.4) —
 * a real process that stays alive between requests. Vercel's serverless
 * functions don't hold state across invocations, so in production Vercel
 * only hosts the short-lived, per-browser `app/api/stream` SSE route,
 * which talks to the Railway consumer's pub/sub over the network instead
 * of holding its own upstream TxLINE connections. In this dev setup
 * (`pnpm dev`, one long-running Next process), the `globalThis` singleton
 * below is *also* the Railway-side consumer, colocated in the same
 * process as the route for simplicity — there is no separate consumer
 * process to talk to yet.
 */
import { EventEmitter } from "node:events";
import { txlineFetch } from "@/lib/txline/http";
import { TxOddsSchema, TxScoreSchema } from "@/lib/txline/schemas";
import type { TxOdds, TxScore } from "@/lib/txline/types";
import type { OddsSnapshot, ScoreEvent } from "@/lib/types";

/** One parsed SSE frame — the unit `Source.connect()` yields. */
export interface RawSseEvent {
  id?: string;
  event?: string;
  data: string;
}

/**
 * What `TxlineStream` consumes. `NetworkSource` (below) is the only real
 * implementation today; a demo-replay `Source` (reading from
 * `demo-data/` instead of the network) is planned for Session 7.1 — this
 * interface exists now so `TxlineStream` never has to change to support
 * it.
 */
export interface Source {
  connect(signal?: AbortSignal): AsyncIterable<RawSseEvent>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Splits a decoded SSE byte stream into frames on blank-line boundaries
 * and parses each frame's `id:`/`event:`/`data:` lines. Uses a plain
 * `\n\n` frame boundary and `\n` line splitting (not `\r\n`) — confirmed
 * against TxLINE's real wire format by probing `/api/odds/stream` and
 * `/api/scores/stream` directly with curl during this session; every
 * frame observed (heartbeats; no live data frame happened to occur during
 * the probe window — see NOTES.md) used bare `\n`.
 */
async function* parseSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RawSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += decoder.decode();

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = parseSseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame) yield frame;
      }

      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(rawFrame: string): RawSseEvent | null {
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of rawFrame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // blank/comment line
    const colonIdx = line.indexOf(":");
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
    // `retry:` and any unknown field are intentionally ignored.
  }

  if (id === undefined && event === undefined && dataLines.length === 0) {
    return null;
  }
  return { id, event, data: dataLines.join("\n") };
}

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

export interface NetworkSourceOptions {
  /** e.g. `/api/odds/stream` or `/api/scores/stream`. */
  path: string;
  fixtureId?: number;
}

/**
 * Default `Source`: fetches a TxLINE SSE endpoint, reads the response body
 * as a stream, and yields parsed frames forever — reconnecting with
 * exponential backoff (1s -> 30s cap) and a `Last-Event-ID` header (taken
 * from the most recent frame's `id`) whenever the connection drops,
 * whether from a network error or the server just closing the stream.
 * Only stops when `signal` aborts.
 */
export class NetworkSource implements Source {
  constructor(private readonly options: NetworkSourceOptions) {}

  async *connect(signal?: AbortSignal): AsyncIterable<RawSseEvent> {
    let lastEventId: string | undefined;
    let attempt = 0;

    while (!signal?.aborted) {
      try {
        const query = new URLSearchParams();
        if (this.options.fixtureId !== undefined) {
          query.set("fixtureId", String(this.options.fixtureId));
        }
        const path = `${this.options.path}${query.size > 0 ? `?${query}` : ""}`;

        const headers = new Headers();
        if (lastEventId !== undefined) {
          headers.set("Last-Event-ID", lastEventId);
        }

        const response = await txlineFetch(path, { headers, signal });
        if (!response.body) {
          throw new Error(`TxLINE stream ${path} returned no response body`);
        }

        attempt = 0; // a successful connect resets backoff
        for await (const frame of parseSseFrames(response.body)) {
          if (frame.id !== undefined) lastEventId = frame.id;
          yield frame;
        }
        // Server closed the stream cleanly — loop straight back to
        // reconnect, no backoff needed for a clean close.
      } catch (err) {
        if (signal?.aborted) return;
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** attempt,
          RECONNECT_MAX_DELAY_MS,
        );
        attempt++;
        console.warn(
          `[txline] stream ${this.options.path} disconnected, reconnecting in ${delay}ms`,
          err,
        );
        await sleep(delay, signal);
      }
    }
  }
}

export type StreamKind = "odds" | "scores";

/**
 * `'status'` is deliberately **not** `FixtureStatus`-typed. TxScore's
 * `StatusId` codes are undocumented (see NOTES.md) and there's no
 * reliable way to map them to `SCHEDULED`/`LIVE`/`FINISHED`/`POSTPONED`/
 * `CANCELLED` yet — this carries the raw envelope fields verbatim so a
 * caller can make its own judgment call until the real normalizer (task
 * 3.3) exists to replace this event's shape with `FixtureStatus`.
 */
export interface RawStatusEvent {
  fixtureId: number;
  action: string;
  gameState: string;
  statusId?: number;
  ts: number;
}

export interface TxlineStreamEvents {
  odds: OddsSnapshot;
  score: ScoreEvent;
  status: RawStatusEvent;
}

const HOME_LABELS = new Set(["home", "1", "team1", "participant1"]);
const DRAW_LABELS = new Set(["draw", "x"]);
const AWAY_LABELS = new Set(["away", "2", "team2", "participant2"]);

/**
 * Maps a full-time 1X2 `OddsPayload` to the domain `OddsSnapshot`.
 *
 * **Unverified against a real captured payload.** TxLINE's OpenAPI spec
 * types `PriceNames` as a bare `string[]` (no enum/examples);
 * `odds.sample.json` is a real-but-empty response (see NOTES.md); and a
 * live probe of `/api/odds/stream` during this session (~5 minutes, both
 * fixture-filtered and unfiltered) only ever produced heartbeats — no
 * live odds activity happened to occur in that window. This is a
 * best-effort match against common label conventions
 * (`Home`/`Draw`/`Away`, `1`/`X`/`2`, ...), restricted to markets with
 * exactly 3 outcomes; returns `null` (frame dropped, nothing emitted) for
 * anything else — including a genuine 1X2 market whose labels don't match
 * any convention tried here — rather than guessing. Re-verify against a
 * real captured `OddsPayload` before trusting this in the demo.
 */
function toOddsSnapshot(raw: TxOdds): OddsSnapshot | null {
  if (raw.PriceNames.length !== 3 || raw.Prices.length !== 3) return null;

  const indexFor = (labels: Set<string>) =>
    raw.PriceNames.findIndex((name) => labels.has(name.trim().toLowerCase()));

  const homeIdx = indexFor(HOME_LABELS);
  const drawIdx = indexFor(DRAW_LABELS);
  const awayIdx = indexFor(AWAY_LABELS);
  if (homeIdx === -1 || drawIdx === -1 || awayIdx === -1) return null;

  // "1953" = 1.953 (see TxOdds.Prices in types.ts).
  const decimalOdds = (scaled: number) => scaled / 1000;
  const impliedPct = (idx: number) => {
    const pct = raw.Pct[idx];
    return pct === "NA" ? 0 : Number(pct);
  };

  return {
    fixtureId: raw.FixtureId,
    home: decimalOdds(raw.Prices[homeIdx]),
    draw: decimalOdds(raw.Prices[drawIdx]),
    away: decimalOdds(raw.Prices[awayIdx]),
    impliedPct: [impliedPct(homeIdx), impliedPct(drawIdx), impliedPct(awayIdx)],
    ts: raw.Ts,
  };
}

/**
 * Maps a scores-stream `Scores` record to the domain `ScoreEvent` — only
 * when the frame actually carries a full-time goal count for both sides
 * (`Score.Participant{1,2}.Total.Goals`); most raw score-stream frames
 * don't (see NOTES.md: most `Action`s only carry `Corners`, not `Goals`,
 * on `Total`), and there's nothing honest to emit for those, so they're
 * dropped rather than backfilled with a fabricated `0`.
 *
 * `status` uses a narrow, fact-based heuristic (not TxScore's undocumented
 * `StatusId`): `Action === "game_finalised"` is a real, observed literal
 * (see scores.sample.json) `-> FINISHED`; anything else carrying goals is
 * necessarily `LIVE` (a finished-and-decided match wouldn't still be
 * pushing live score-stream frames). Never produces `SCHEDULED`/
 * `POSTPONED`/`CANCELLED` — those need the real normalizer (task 3.3).
 */
function toScoreEvent(raw: TxScore): ScoreEvent | null {
  const score = raw.Score as
    | {
        Participant1?: { Total?: { Goals?: number } };
        Participant2?: { Total?: { Goals?: number } };
      }
    | undefined;
  const home = score?.Participant1?.Total?.Goals;
  const away = score?.Participant2?.Total?.Goals;
  if (home === undefined || away === undefined) return null;

  return {
    fixtureId: raw.FixtureId,
    home,
    away,
    minute: raw.Clock ? Math.floor(raw.Clock.Seconds / 60) : undefined,
    status: raw.Action === "game_finalised" ? "FINISHED" : "LIVE",
  };
}

/**
 * Consumes one raw TxLINE SSE `Source` and emits typed domain events —
 * `'odds'`, `'score'`, `'status'` (see `TxlineStreamEvents`). One instance
 * per upstream stream (odds, scores); `TxlineStreamManager` below owns one
 * of each and merges their output into a single pub/sub.
 */
export declare interface TxlineStream {
  on<K extends keyof TxlineStreamEvents>(
    event: K,
    listener: (payload: TxlineStreamEvents[K]) => void,
  ): this;
  off<K extends keyof TxlineStreamEvents>(
    event: K,
    listener: (payload: TxlineStreamEvents[K]) => void,
  ): this;
  emit<K extends keyof TxlineStreamEvents>(
    event: K,
    payload: TxlineStreamEvents[K],
  ): boolean;
}

export class TxlineStream extends EventEmitter {
  private readonly source: Source;
  private readonly kind: StreamKind;
  private controller: AbortController | null = null;

  constructor(source: Source, kind: StreamKind) {
    super();
    this.source = source;
    this.kind = kind;
  }

  start(): void {
    if (this.controller) return;
    this.controller = new AbortController();
    void this.consume(this.controller.signal);
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }

  private async consume(signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of this.source.connect(signal)) {
        // Heartbeats are a liveness signal for `NetworkSource`'s own
        // reconnect logic (an idle-too-long connection looks the same as
        // a dead one otherwise) — not a domain event.
        if (frame.event === "heartbeat" || !frame.data) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch (err) {
          console.warn(`[txline] ${this.kind} stream: unparseable frame`, frame.data, err);
          continue;
        }

        if (this.kind === "odds") this.handleOdds(parsed);
        else this.handleScores(parsed);
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error(`[txline] ${this.kind} stream consumer crashed`, err);
      }
    }
  }

  private handleOdds(raw: unknown): void {
    const result = TxOddsSchema.safeParse(raw);
    if (!result.success) {
      console.warn("[txline] odds stream: payload failed schema validation", result.error.message);
      return;
    }
    const snapshot = toOddsSnapshot(result.data);
    if (snapshot) this.emit("odds", snapshot);
  }

  private handleScores(raw: unknown): void {
    const result = TxScoreSchema.safeParse(raw);
    if (!result.success) {
      console.warn("[txline] scores stream: payload failed schema validation", result.error.message);
      return;
    }

    this.emit("status", {
      fixtureId: result.data.FixtureId,
      action: result.data.Action,
      gameState: result.data.GameState,
      statusId: result.data.StatusId,
      ts: result.data.Ts,
    });

    const scoreEvent = toScoreEvent(result.data);
    if (scoreEvent) this.emit("score", scoreEvent);
  }
}

/**
 * Owns the two long-lived upstream connections (odds, scores — TxLINE has
 * no combined stream) and re-emits their typed events on one merged
 * emitter, so `app/api/stream/route.ts` only ever has to subscribe to one
 * thing per browser client, regardless of how many upstream streams that
 * actually takes.
 */
export declare interface TxlineStreamManager {
  on<K extends keyof TxlineStreamEvents>(
    event: K,
    listener: (payload: TxlineStreamEvents[K]) => void,
  ): this;
  off<K extends keyof TxlineStreamEvents>(
    event: K,
    listener: (payload: TxlineStreamEvents[K]) => void,
  ): this;
  emit<K extends keyof TxlineStreamEvents>(
    event: K,
    payload: TxlineStreamEvents[K],
  ): boolean;
}

export class TxlineStreamManager extends EventEmitter {
  private readonly odds: TxlineStream;
  private readonly scores: TxlineStream;
  private started = false;

  constructor() {
    super();
    // Every `app/api/stream` request adds a listener here — unbounded by
    // design, not a leak (Node's default-10 warning doesn't apply).
    this.setMaxListeners(0);

    this.odds = new TxlineStream(new NetworkSource({ path: "/api/odds/stream" }), "odds");
    this.scores = new TxlineStream(new NetworkSource({ path: "/api/scores/stream" }), "scores");

    this.odds.on("odds", (payload) => this.emit("odds", payload));
    this.scores.on("score", (payload) => this.emit("score", payload));
    this.scores.on("status", (payload) => this.emit("status", payload));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.odds.start();
    this.scores.start();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __txlineStreamManager: TxlineStreamManager | undefined;
}

/**
 * The server singleton consumer. `globalThis`-guarded so Next's dev-mode
 * hot-reload (which re-evaluates this module on every edit) reuses the
 * same manager — and its two live upstream TxLINE connections — instead
 * of leaking a fresh pair on every save. In production this is the
 * in-process stand-in for the real Railway consumer (see the module-level
 * doc comment above).
 */
export function getTxlineStream(): TxlineStreamManager {
  if (!globalThis.__txlineStreamManager) {
    globalThis.__txlineStreamManager = new TxlineStreamManager();
  }
  globalThis.__txlineStreamManager.start();
  return globalThis.__txlineStreamManager;
}

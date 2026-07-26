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
import { toOddsSnapshot, toScoreEvent } from "@/lib/txline/normalize";
import { isDemoModeEnabled, loadDemoScenarios } from "@/lib/txline/demoScenarios";
import { ReplaySource } from "@/lib/txline/replaySource";
import type { OddsSnapshot, ScoreEvent } from "@/lib/types";

/** One parsed SSE frame — the unit `Source.connect()` yields. */
export interface RawSseEvent {
  id?: string;
  event?: string;
  data: string;
}

/**
 * What `TxlineStream` consumes. `NetworkSource` (below) talks to real
 * TxLINE; `lib/txline/replaySource.ts#ReplaySource` (Session 7.1) reads a
 * recorded `demo-data/` scenario instead — this interface existed before
 * that second implementation did specifically so `TxlineStream` never had
 * to change to support it, and it didn't.
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
 * `'status'` is deliberately **not** `FixtureStatus`-typed, even though
 * `lib/txline/normalize.ts` now has a real `TxScore.StatusId` ->
 * `FixtureStatus` mapping (`toScoreEvent`'s `status` field uses it). This
 * event exists for a different case: it fires on *every* scores-stream
 * frame, including the many `Action`s that carry no `Score` data at all
 * (`kickoff_team`, `lineups`, ...) and so never produce a `'score'` event
 * — a caller that only wants "did anything happen for this fixture" needs
 * the raw envelope regardless of whether `Score` was present. Carries the
 * raw fields verbatim rather than just `FixtureStatus` so a caller can
 * still see the underlying `action`/`statusId` a normalized value would
 * throw away.
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

/**
 * Consumes one raw TxLINE SSE `Source` and emits typed domain events —
 * `'odds'`, `'score'`, `'status'` (see `TxlineStreamEvents`). One instance
 * per upstream stream (odds, scores); `TxlineStreamManager` below owns one
 * of each and merges their output into a single pub/sub.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- standard Node typed-EventEmitter pattern: interface adds typed on/off/emit overloads, class supplies the real implementation
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the interface above
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
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- standard Node typed-EventEmitter pattern: interface adds typed on/off/emit overloads, class supplies the real implementation
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the interface above
export class TxlineStreamManager extends EventEmitter {
  private readonly streams: TxlineStream[] = [];
  private started = false;

  /**
   * Real fixtures always get their two live `NetworkSource`-backed
   * streams, unconditionally — `DEMO_MODE` only ever *adds* a
   * `ReplaySource`-backed pair per registered scenario on top, one
   * `TxlineStream` each (same "one stream per kind" shape the real pair
   * already uses), all wired onto this one merged emitter. A subscriber
   * (`app/api/stream/route.ts`, `StatusTracker`) never has to know or
   * care whether a given `'odds'`/`'score'`/`'status'` event came from
   * TxLINE or from a recording — real and demo fixtures are genuinely
   * merged, not switched between.
   */
  constructor() {
    super();
    // Every `app/api/stream` request adds a listener here — unbounded by
    // design, not a leak (Node's default-10 warning doesn't apply).
    this.setMaxListeners(0);

    this.addPair(
      new TxlineStream(new NetworkSource({ path: "/api/odds/stream" }), "odds"),
      new TxlineStream(new NetworkSource({ path: "/api/scores/stream" }), "scores"),
    );

    if (isDemoModeEnabled()) {
      for (const scenario of loadDemoScenarios()) {
        this.addPair(
          new TxlineStream(new ReplaySource({ scenario: scenario.meta.scenario, kind: "odds" }), "odds"),
          new TxlineStream(new ReplaySource({ scenario: scenario.meta.scenario, kind: "scores" }), "scores"),
        );
      }
    }
  }

  private addPair(odds: TxlineStream, scores: TxlineStream): void {
    odds.on("odds", (payload) => this.emit("odds", payload));
    scores.on("score", (payload) => this.emit("score", payload));
    scores.on("status", (payload) => this.emit("status", payload));
    this.streams.push(odds, scores);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const stream of this.streams) stream.start();
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

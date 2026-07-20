"use client";

import { useEffect, useState } from "react";
import type { OddsSnapshot, ScoreEvent } from "@/lib/types";
// Type-only — erased at compile time, so this doesn't pull the
// server-only `lib/txline/stream.ts` module (or its `node:events`
// dependency) into the client bundle. See that file's `RawStatusEvent`
// doc comment for why `status` isn't `FixtureStatus`-typed yet.
import type { RawStatusEvent } from "@/lib/txline/stream";

export interface LiveFixtureState {
  odds: OddsSnapshot | null;
  score: ScoreEvent | null;
  status: RawStatusEvent | null;
  /** Whether the underlying `EventSource` is currently connected. */
  connected: boolean;
}

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Subscribes to `/api/stream?fixtureId=` for one fixture's live odds,
 * score, and status events. Manages its own `EventSource` reconnect with
 * backoff (rather than relying on the browser's built-in retry, which
 * uses a fixed ~3s interval and has no visibility into `connected` state)
 * and cleans up on unmount / `fixtureId` change.
 */
export function useLiveFixture(fixtureId: number): LiveFixtureState {
  const [odds, setOdds] = useState<OddsSnapshot | null>(null);
  const [score, setScore] = useState<ScoreEvent | null>(null);
  const [status, setStatus] = useState<RawStatusEvent | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    setOdds(null);
    setScore(null);
    setStatus(null);
    setConnected(false);

    function connect() {
      if (cancelled) return;

      source = new EventSource(`/api/stream?fixtureId=${fixtureId}`);

      source.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      source.addEventListener("odds", (event) => {
        setOdds(JSON.parse((event as MessageEvent<string>).data));
      });
      source.addEventListener("score", (event) => {
        setScore(JSON.parse((event as MessageEvent<string>).data));
      });
      source.addEventListener("status", (event) => {
        setStatus(JSON.parse((event as MessageEvent<string>).data));
      });

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (cancelled) return;

        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** attempt,
          RECONNECT_MAX_DELAY_MS,
        );
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [fixtureId]);

  return { odds, score, status, connected };
}

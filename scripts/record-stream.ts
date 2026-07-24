/**
 * Connects the REAL TxLINE stream (`lib/txline/stream.ts#NetworkSource` —
 * the same class `TxlineStreamManager` uses for real fixtures, not a
 * mock) and records every raw frame to `demo-data/raw/<date>-<fixture>.ndjson`,
 * one `{t, event, data}` line per frame, in exactly the format
 * `lib/txline/replaySource.ts` already reads (and `scripts/trim-recording.ts`
 * cuts) — a recording made tonight needs no format conversion before it
 * can become a demo scenario.
 *
 * Deliberately records at the raw-frame level, not through
 * `TxlineStream`'s own domain-event parsing: `TxlineStream.handleOdds`
 * silently drops a frame `toOddsSnapshot` doesn't recognize (a non-3-way
 * market, an unfamiliar price-label convention — see that function's own
 * doc comment). A recorder's job is to not lose data future code might
 * learn to understand; every non-heartbeat frame with a body gets written
 * verbatim, decided-what's-useful-later at trim time instead.
 *
 * `flush-on-write`: every line is written with `fs.writeSync` on a
 * `fs.openSync(..., "a")` file descriptor, not through a buffered
 * `WriteStream` — if this process is killed (Ctrl-C, a crash, the
 * terminal closing) mid-match, every frame received up to that exact
 * moment is already durably on disk, not sitting in a JS-level buffer
 * that dies with the process. This is the whole point of a live-match
 * recorder: there is no "run it again" for a goal that already happened.
 *
 * REST snapshots (`getFixtures`/`getOdds`/`getScores`) are additionally
 * appended to a sibling `.rest.json` every 5 minutes — a periodic,
 * timestamped log of REST-side state alongside the SSE stream, useful for
 * cross-checking the live feed against what the snapshot endpoints
 * reported at that moment.
 *
 * Usage:
 *   pnpm tsx scripts/record-stream.ts [--fixture <id>] [--duration <seconds>]
 *
 * `--fixture` narrows both the SSE subscriptions and the REST snapshots
 * to one fixture (recommended for an actual live match — the unfiltered
 * feed carries every in-progress World Cup fixture at once). Omit it to
 * record everything. `--duration` auto-stops after N seconds — mainly for
 * a bounded verification run rather than an actual all-night recording,
 * where Ctrl-C (SIGINT) is the real way to stop.
 */
import { existsSync, openSync, writeSync, closeSync, mkdirSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

import { NetworkSource } from "@/lib/txline/stream";
import { getFixtures, getOdds, getScores } from "@/lib/txline/client";

const REST_SNAPSHOT_INTERVAL_MS = 5 * 60_000;
const WORLD_CUP_COMPETITION_ID = 72;
const TOURNAMENT_START_EPOCH_DAY = 20_632; // see scripts/sync-markets.ts

function printReminderBanner(): void {
  const now = new Date();
  const sf1 = new Date(Date.UTC(2026, 6, 14)); // 2026-07-14
  const sf2 = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15
  const stale = now.getTime() > sf2.getTime() + 24 * 60 * 60 * 1000;

  const lines = [
    "╔══════════════════════════════════════════════════════════════╗",
    "║  SF1 TONIGHT (Jul 14) and SF2 (Jul 15) MUST BE RECORDED.       ║",
    "║  There is no replay of a live match that wasn't captured.      ║",
    "║  SET ALARMS. Run this script BEFORE kickoff, not after.        ║",
    "╚══════════════════════════════════════════════════════════════╝",
  ];
  console.log(lines.join("\n"));

  if (stale) {
    console.warn(
      `\n⚠ Today is ${now.toISOString().slice(0, 10)} — the SF1/SF2 dates above (Jul 14/15) are ` +
        `already in the past. This reminder is stale (written before those matches happened, or this ` +
        `script is being run after them). Recording tonight's actual fixture, not SF1/SF2, if that's ` +
        `the real intent — check with whoever wrote the reminder text before assuming it's still current.\n`,
    );
  }
}

interface Args {
  fixtureId?: number;
  durationSeconds?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture") args.fixtureId = Number(argv[++i]);
    else if (argv[i] === "--duration") args.durationSeconds = Number(argv[++i]);
  }
  return args;
}

function todayDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

class FlushOnWriteFile {
  private readonly fd: number;
  private lineCount = 0;

  constructor(readonly path: string) {
    mkdirSync(join(path, ".."), { recursive: true });
    this.fd = openSync(path, "a");
  }

  writeLine(obj: unknown): void {
    writeSync(this.fd, JSON.stringify(obj) + "\n");
    this.lineCount++;
  }

  get count(): number {
    return this.lineCount;
  }

  close(): void {
    closeSync(this.fd);
  }
}

async function recordRestSnapshot(file: FlushOnWriteFile, fixtureId: number | undefined): Promise<void> {
  try {
    const [fixtures, odds, scores] = await Promise.all([
      getFixtures({ competition: WORLD_CUP_COMPETITION_ID, from: TOURNAMENT_START_EPOCH_DAY * 86_400 }),
      fixtureId !== undefined ? getOdds(fixtureId) : Promise.resolve([]),
      fixtureId !== undefined ? getScores(fixtureId) : Promise.resolve([]),
    ]);
    const snapshot = {
      takenAt: new Date().toISOString(),
      fixtures: fixtureId !== undefined ? fixtures.filter((f) => f.FixtureId === fixtureId) : fixtures,
      odds,
      scores,
    };
    file.writeLine(snapshot);
    console.log(`[record-stream] REST snapshot appended (${file.path})`);
  } catch (err) {
    console.error("[record-stream] REST snapshot failed (continuing — the SSE recording is unaffected)", err);
  }
}

async function main() {
  printReminderBanner();

  const { fixtureId, durationSeconds } = parseArgs(process.argv.slice(2));
  const fixtureLabel = fixtureId !== undefined ? String(fixtureId) : "all";
  const rawDir = join(process.cwd(), "demo-data", "raw");
  const ndjsonPath = join(rawDir, `${todayDateStamp()}-${fixtureLabel}.ndjson`);
  const restPath = join(rawDir, `${todayDateStamp()}-${fixtureLabel}.rest.json`);

  const ndjsonFile = new FlushOnWriteFile(ndjsonPath);
  const restFile = new FlushOnWriteFile(restPath);

  console.log(`[record-stream] fixture: ${fixtureLabel}`);
  console.log(`[record-stream] writing: ${ndjsonPath}`);
  console.log(`[record-stream] REST snapshots every ${REST_SNAPSHOT_INTERVAL_MS / 60_000}min -> ${restPath}`);
  if (durationSeconds !== undefined) {
    console.log(`[record-stream] auto-stopping after ${durationSeconds}s (verification run, not a real recording)`);
  }

  const controller = new AbortController();
  const startedAt = Date.now();

  const odds = new NetworkSource({ path: "/api/odds/stream", fixtureId });
  const scores = new NetworkSource({ path: "/api/scores/stream", fixtureId });

  async function consume(source: NetworkSource, kind: "odds" | "scores"): Promise<void> {
    for await (const frame of source.connect(controller.signal)) {
      if (frame.event === "heartbeat" || !frame.data) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.data);
      } catch (err) {
        console.warn(`[record-stream] ${kind}: unparseable frame, skipping`, frame.data, err);
        continue;
      }

      ndjsonFile.writeLine({ t: Date.now() - startedAt, event: kind, data: parsed });
      if (ndjsonFile.count % 10 === 0) {
        console.log(`[record-stream] ${ndjsonFile.count} frames recorded so far`);
      }
    }
  }

  const restTimer = setInterval(() => void recordRestSnapshot(restFile, fixtureId), REST_SNAPSHOT_INTERVAL_MS);
  void recordRestSnapshot(restFile, fixtureId); // one immediately, don't wait 5min for the first

  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  if (durationSeconds !== undefined) {
    durationTimer = setTimeout(() => controller.abort(), durationSeconds * 1000);
  }

  function shutdown(signal: string): void {
    console.log(`\n[record-stream] ${signal} — stopping (${ndjsonFile.count} frames recorded)`);
    controller.abort();
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await Promise.all([consume(odds, "odds"), consume(scores, "scores")]);

  clearInterval(restTimer);
  if (durationTimer) clearTimeout(durationTimer);
  ndjsonFile.close();
  restFile.close();

  console.log(`\n[record-stream] done — ${ndjsonFile.count} frames written to ${ndjsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

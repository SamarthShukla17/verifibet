/**
 * Cuts a highlight window out of a `scripts/record-stream.ts` recording —
 * a late-goal last-10-minutes is the canonical case this exists for, but
 * any window works. Output is a plain `{t, event, data}` ndjson, `t`
 * rebased to 0 at the first kept line, in exactly the shape
 * `lib/txline/replaySource.ts` reads and `scripts/build-demo-scenario.ts`
 * already produces by hand — a trimmed recording can become
 * `demo-data/scenarios/<name>.ndjson` directly (write the matching
 * `.rest.json` bundle separately; this tool only cuts the timeline).
 *
 * `--from`/`--to` each accept either an ISO datetime (matched against
 * every line's own real `data.Ts` — every recorded `TxScore`/`TxOdds`
 * carries one) or a bare number of seconds since the *recording's* own
 * start (matched against the ndjson's own relative `t` field instead) —
 * whichever is more natural for how you're describing the window
 * ("from 22:24 UTC to 22:34 UTC" vs. "the last 600 seconds").
 *
 * Usage:
 *   pnpm tsx scripts/trim-recording.ts <in.ndjson> <out.ndjson> --from <ISO|seconds> --to <ISO|seconds>
 *
 * Either bound may be omitted for an open-ended cut (e.g. `--from` only
 * keeps everything from that point to the end of the recording).
 */
import { readFileSync, writeFileSync } from "node:fs";

interface NdjsonLine {
  t: number;
  event: string;
  data: { Ts?: number; [key: string]: unknown };
}

type Bound = { kind: "absolute"; ms: number } | { kind: "relative"; ms: number };

function parseBound(raw: string): Bound {
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) return { kind: "absolute", ms: asDate };

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds)) return { kind: "relative", ms: asSeconds * 1000 };

  throw new Error(`--from/--to value "${raw}" is neither a parseable ISO datetime nor a plain number of seconds`);
}

function boundValue(bound: Bound, line: NdjsonLine): number {
  return bound.kind === "absolute" ? (line.data.Ts ?? Number.NaN) : line.t;
}

interface Args {
  inPath: string;
  outPath: string;
  from?: Bound;
  to?: Bound;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length < 2) {
    throw new Error("usage: pnpm tsx scripts/trim-recording.ts <in.ndjson> <out.ndjson> --from <ISO|seconds> --to <ISO|seconds>");
  }
  const [inPath, outPath] = positional;

  let from: Bound | undefined;
  let to: Bound | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") from = parseBound(argv[++i]);
    else if (argv[i] === "--to") to = parseBound(argv[++i]);
  }
  return { inPath, outPath, from, to };
}

function main() {
  const { inPath, outPath, from, to } = parseArgs(process.argv.slice(2));

  const rawLines = readFileSync(inPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const lines: NdjsonLine[] = rawLines.map((l) => JSON.parse(l) as NdjsonLine);
  console.log(`[trim-recording] read ${lines.length} lines from ${inPath}`);

  const kept = lines.filter((line) => {
    if (from) {
      const v = boundValue(from, line);
      if (Number.isNaN(v) || v < from.ms) return false;
    }
    if (to) {
      const v = boundValue(to, line);
      if (Number.isNaN(v) || v > to.ms) return false;
    }
    return true;
  });

  if (kept.length === 0) {
    throw new Error("no lines fall inside --from/--to — check the window against the recording's real timestamps");
  }

  const baseT = kept[0].t;
  const rebased = kept.map((line) => ({ ...line, t: line.t - baseT }));

  writeFileSync(outPath, rebased.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const firstTs = kept[0].data.Ts;
  const lastTs = kept[kept.length - 1].data.Ts;
  console.log(`[trim-recording] kept ${kept.length}/${lines.length} lines`);
  if (firstTs !== undefined && lastTs !== undefined) {
    console.log(`[trim-recording] real window: ${new Date(firstTs).toISOString()} -> ${new Date(lastTs).toISOString()}`);
  }
  console.log(`[trim-recording] wrote ${outPath}`);
}

main();

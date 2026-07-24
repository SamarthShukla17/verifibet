/**
 * One pino instance, stdout + `keeper/logs.ndjson` + (when configured)
 * Upstash — shared by `keeper/index.ts`'s long-running loop and
 * `keeper/resolver.ts`'s CLI backfill, both append to the same
 * destinations so a fixture resolved via `pnpm keeper:resolve` shows up
 * in the same history as one resolved automatically by the loop.
 *
 * The Upstash stream exists for `app/api/keeper/logs` (the keeper
 * dashboard) — in production the keeper is a separate long-lived process
 * from the Next server (see `lib/txline/stream.ts`'s doc comment on the
 * Railway/Vercel split), which has no filesystem access to this process's
 * local `logs.ndjson`. `lib/keeperLogs.ts#pushKeeperLogLine` already
 * no-ops when `UPSTASH_REDIS_REST_URL`/`TOKEN` aren't set, so this stream
 * is always safe to include — it's a real no-op in local dev, not a
 * conditional branch to maintain here.
 */
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { pushKeeperLogLine } from "@/lib/keeperLogs";

export function buildLogger(): pino.Logger {
  const fileStream = createWriteStream(join(process.cwd(), "keeper", "logs.ndjson"), { flags: "a" });
  const redisStream = {
    write(chunk: string) {
      void pushKeeperLogLine(chunk);
      return true;
    },
  };
  return pino(
    { level: "info" },
    pino.multistream([{ stream: process.stdout }, { stream: fileStream }, { stream: redisStream }]),
  );
}

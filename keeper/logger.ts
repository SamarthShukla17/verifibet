/**
 * One pino instance, stdout + `keeper/logs.ndjson`, shared by `keeper/index.ts`'s
 * long-running loop and `keeper/resolver.ts`'s CLI backfill — both append
 * to the same file so a fixture resolved via `pnpm keeper:resolve` shows
 * up in the same history as one resolved automatically by the loop.
 */
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import pino from "pino";

export function buildLogger(): pino.Logger {
  const fileStream = createWriteStream(join(process.cwd(), "keeper", "logs.ndjson"), { flags: "a" });
  return pino({ level: "info" }, pino.multistream([{ stream: process.stdout }, { stream: fileStream }]));
}

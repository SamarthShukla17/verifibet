/**
 * Runs the TxLINE off-chain activation flow for the subscription recorded by
 * `pnpm txline:subscribe`: guest JWT -> sign activation message -> API
 * token. Writes TXLINE_JWT / TXLINE_API_TOKEN into .env.local.
 *
 * Usage: pnpm txline:activate
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

import { getGuestJwt, activateToken } from "@/lib/txline/auth";
import { TxlineApiError } from "@/lib/txline/http";

const KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");
const SUBSCRIPTION_PATH = join(process.cwd(), ".txline-subscription.json");
const ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

// Standard World Cup & Int'l Friendlies bundle (Service Level 1) uses the
// empty leagues array — see documentation/subscription-tiers.mdx in
// github.com/txodds/tx-on-chain.
const LEAGUES: number[] = [];

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function mask(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}...${secret.slice(-4)} (${secret.length} chars)`;
}

/** Idempotent upsert: replaces existing KEY= lines in place, appends new ones. */
function upsertEnvLocal(path: string, updates: Record<string, string>): void {
  const lines = existsSync(path)
    ? readFileSync(path, "utf-8").split("\n")
    : [];
  const remaining = new Set(Object.keys(updates));

  const merged = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && remaining.has(match[1])) {
      const key = match[1];
      remaining.delete(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Drop a single trailing blank line before appending so we don't
  // accumulate blank lines across repeated runs.
  if (merged.length > 0 && merged[merged.length - 1] === "") {
    merged.pop();
  }
  for (const key of Array.from(remaining)) {
    merged.push(`${key}=${updates[key]}`);
  }

  writeFileSync(path, merged.join("\n") + "\n");
}

async function main() {
  if (!existsSync(SUBSCRIPTION_PATH)) {
    throw new Error(
      `${SUBSCRIPTION_PATH} not found — run \`pnpm txline:subscribe\` first.`,
    );
  }
  const subscription = JSON.parse(
    readFileSync(SUBSCRIPTION_PATH, "utf-8"),
  ) as { txSig: string; wallet: string };

  const subscriber = loadKeypair(KEYPAIR_PATH);
  if (subscriber.publicKey.toBase58() !== subscription.wallet) {
    throw new Error(
      `Keypair at ${KEYPAIR_PATH} (${subscriber.publicKey.toBase58()}) does not ` +
        `match the subscribing wallet in ${SUBSCRIPTION_PATH} (${subscription.wallet}).`,
    );
  }

  console.log(`txSig:  ${subscription.txSig}`);
  console.log(`wallet: ${subscriber.publicKey.toBase58()}`);

  try {
    console.log("Requesting guest JWT (POST /auth/guest/start)...");
    const jwt = await getGuestJwt();
    console.log(`JWT: ${mask(jwt)}`);

    console.log("Signing activation message and posting /api/token/activate...");
    const apiToken = await activateToken(
      subscription.txSig,
      LEAGUES,
      jwt,
      subscriber,
    );
    console.log(`API token: ${mask(apiToken)}`);

    upsertEnvLocal(ENV_LOCAL_PATH, {
      TXLINE_JWT: jwt,
      TXLINE_API_TOKEN: apiToken,
    });
    console.log(`Wrote TXLINE_JWT and TXLINE_API_TOKEN to ${ENV_LOCAL_PATH}`);
  } catch (err) {
    if (err instanceof TxlineApiError) {
      console.error(`[txline] HTTP ${err.status} — response body: ${err.body}`);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

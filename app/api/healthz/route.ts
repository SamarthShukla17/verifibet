/**
 * GET /api/healthz — app-level liveness for the deployed Next server
 * itself, for UptimeRobot to poll (see NOTES.md's "v1.0.0 hackathon pass"
 * entry). Deliberately distinct from `/api/keeper/status`'s proxied
 * `:8787/healthz`: that one reports whether a *keeper process* is alive
 * (never true in production — no hosted keeper, see `lib/keeperLogs.ts`'s
 * doc comment) — this one reports whether the app judges actually browse
 * is up and can still reach its two real dependencies, the devnet RPC and
 * Upstash. A judge opening the app Jul 20–29 cares about this one, not the
 * keeper's.
 *
 * Both checks are cheap and short-timeout on purpose — this endpoint
 * exists to be polled every few minutes, not to be a deep dependency
 * audit. `rpcOk`/`redisOk` degrade independently and are both informational
 * only: the route always returns 200 (an UptimeRobot "down" alert should
 * mean "the app didn't respond," not "TxLINE/RPC had a blip"), with the
 * degraded state visible in the JSON body for anyone who looks.
 */
import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { Redis } from "@upstash/redis";
import { CONFIG } from "@/lib/config";

export const runtime = "nodejs";

const CHECK_TIMEOUT_MS = 4_000;

async function checkRpc(): Promise<boolean> {
  try {
    const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
    await Promise.race([
      connection.getSlot(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return true; // not configured = not a failure, same convention as lib/cache.ts
  try {
    const redis = new Redis({ url, token });
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const [rpcOk, redisOk] = await Promise.all([checkRpc(), checkRedis()]);

  return NextResponse.json(
    {
      ok: true,
      time: new Date().toISOString(),
      rpcOk,
      redisOk,
    },
    { status: 200 },
  );
}

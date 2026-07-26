/**
 * GET /api/keeper/status — the keeper dashboard's (`app/keeper/page.tsx`)
 * top summary cards: keeper wallet address + SOL balance (from
 * `KEEPER_SECRET_KEY`, the same env var `keeper/index.ts` itself boots
 * from — never sent back except as the derived public address + balance,
 * same "secret stays server-only" convention as TxLINE's own tokens),
 * plus a proxied read of the keeper process's own `:8787/healthz`
 * (uptime, last tick, pending queue depth). A browser can't fetch the
 * keeper's healthz port directly — different origin, no CORS headers on
 * that plain `http` server — so this route does it server-side and
 * re-serves the result same-origin.
 *
 * `KEEPER_HEALTHZ_URL` (default `http://localhost:8787/healthz`) is
 * deliberately *not* set on the deployed Vercel app (2026-07-26 deploy:
 * no hosted keeper — resolution runs through the manual backfill CLI, not
 * a daemon — see `lib/keeperLogs.ts`'s doc comment), so in production this
 * proxy always resolves against `localhost:8787` inside whatever
 * serverless instance is handling the request — never reachable, and not
 * meant to be. That's the honest permanent state, not a placeholder for a
 * not-yet-deployed process: the keeper only ever runs on an operator's own
 * machine, where `KEEPER_HEALTHZ_URL` correctly defaults to that machine's
 * own localhost.
 *
 * Both halves degrade independently and honestly — an unreachable keeper
 * process (`healthz: null`) is a real, expected state (the loop isn't
 * running right now, or is running locally and not this dashboard's own
 * process) worth showing as "offline", not an error that takes the whole
 * dashboard down.
 */
import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "@/lib/config";
import { loadKeeperKeypair } from "@/keeper/jobs";

export const runtime = "nodejs";

const HEALTHZ_TIMEOUT_MS = 3_000;

export interface KeeperHealthz {
  uptime: number;
  lastTick: string;
  pendingJobs: number;
}

export interface KeeperWallet {
  address: string;
  solBalance: number;
}

async function fetchHealthz(): Promise<KeeperHealthz | null> {
  const url = process.env.KEEPER_HEALTHZ_URL ?? "http://localhost:8787/healthz";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTHZ_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as KeeperHealthz;
  } catch {
    return null;
  }
}

async function fetchWallet(): Promise<KeeperWallet | null> {
  const secret = process.env.KEEPER_SECRET_KEY;
  if (!secret) return null;
  try {
    const keeper = loadKeeperKeypair(secret);
    const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
    const lamports = await connection.getBalance(keeper.publicKey);
    return { address: keeper.publicKey.toBase58(), solBalance: lamports / 1_000_000_000 };
  } catch {
    return null;
  }
}

export async function GET() {
  const [healthz, wallet] = await Promise.all([fetchHealthz(), fetchWallet()]);
  return NextResponse.json({ healthz, wallet });
}

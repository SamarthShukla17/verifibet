/**
 * POST /api/hooks/helius — Helius "enhanced" webhook target for the
 * VERIFIBET program (`CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw`, see
 * CLAUDE.md). Configured in the Helius dashboard (free tier, devnet,
 * account address = the program, txn types = Any) to push here on every
 * transaction that touches the program — the one source of real-time
 * on-chain activity the deployed app has, given there's no hosted keeper
 * process (2026-07-26 deploy decision — see `lib/keeperLogs.ts`'s doc
 * comment) to log its own actions from a live Vercel instance.
 *
 * Deliberately pushes into the *same* Upstash list `lib/keeperLogs.ts`
 * already maintains (`keeper:logs`), not a separate one — `/api/keeper/logs`
 * and therefore `/keeper` already know how to read, filter, and render that
 * shape (`KeeperLogEntry`/`KeeperActionsTable`), so every VERIFIBET
 * instruction Helius reports here shows up in the exact same "Recent
 * Actions" table a locally-run keeper's own log lines would, with zero
 * changes to that display code. This is what "powers /keeper in prod"
 * means in practice: prod never has a live keeper tick to log from, but it
 * does have this.
 *
 * Auth: Helius echoes whatever string was configured as the webhook's
 * "Authentication Header" back as the literal `Authorization` header on
 * every POST — compared against `HELIUS_WEBHOOK_AUTH_HEADER` here so an
 * arbitrary POST to this URL can't inject fake keeper activity. Requests
 * missing or failing that check are rejected before any parsing.
 */
import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";

import verifibetIdl from "@/lib/solana/idl/verifibet.json";
import { PROGRAM_ID } from "@/lib/solana/pda";
import { pushKeeperLogLine } from "@/lib/keeperLogs";

export const runtime = "nodejs";

interface HeliusInstruction {
  programId: string;
  data: string;
  accounts: string[];
}

interface HeliusEnhancedTransaction {
  signature: string;
  slot: number;
  timestamp: number; // unix seconds
  transactionError: unknown | null;
  instructions?: HeliusInstruction[];
}

/** 8-byte Anchor discriminator (base58-decoded instruction data's first 8
 * bytes) -> instruction name, built once from the same IDL `program.ts`
 * loads — never hand-maintained, so it can't drift from the deployed
 * program's real instruction set. */
const DISCRIMINATOR_TO_NAME = new Map<string, string>(
  (verifibetIdl as { instructions: { name: string; discriminator: number[] }[] }).instructions.map((ix) => [
    Buffer.from(ix.discriminator).toString("hex"),
    ix.name,
  ]),
);

/** Friendly one-line description per instruction — shown in the Recent
 * Actions table's status chip when the tx succeeded (see
 * `KeeperStatusChip`'s fallback branch, which just renders `entry.msg`). */
const SUCCESS_MSG: Record<string, string> = {
  initialize: "program initialized",
  initialize_market: "market initialized",
  place_bet: "bet placed",
  lock_market: "market locked",
  resolve_market: "market resolved",
  claim_winnings: "winnings claimed",
  void_market: "market voided",
  claim_refund: "refund claimed",
};

/** `KeeperStatusChip` special-cases `action === "resolved" | "locked"` for
 * the same primary-color pill a locally-run keeper's own `resolveFixture`/
 * `lockMarketJob` log lines get — matching that here keeps a judge from
 * seeing two different visual treatments for the same real event depending
 * on whether it happened to be observed by a local keeper or this webhook. */
const ACTION: Record<string, string> = {
  resolve_market: "resolved",
  lock_market: "locked",
};

function instructionName(data: string): string | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(anchor.utils.bytes.bs58.decode(data));
  } catch {
    return null;
  }
  if (raw.length < 8) return null;
  return DISCRIMINATOR_TO_NAME.get(raw.subarray(0, 8).toString("hex")) ?? null;
}

export async function POST(req: Request) {
  const expected = process.env.HELIUS_WEBHOOK_AUTH_HEADER;
  if (!expected) {
    console.error("[hooks/helius] HELIUS_WEBHOOK_AUTH_HEADER not configured — rejecting");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const txs = Array.isArray(body) ? (body as HeliusEnhancedTransaction[]) : [];
  const programIdStr = PROGRAM_ID.toBase58();
  let pushed = 0;

  for (const tx of txs) {
    const matched = (tx.instructions ?? []).filter((ix) => ix.programId === programIdStr);
    const failed = tx.transactionError != null;

    for (const ix of matched) {
      const name = instructionName(ix.data);
      if (!name) continue;

      const line = JSON.stringify({
        level: failed ? 50 : 30,
        time: tx.timestamp * 1000,
        job: name,
        txSig: tx.signature,
        action: !failed ? (ACTION[name] ?? undefined) : undefined,
        error: failed ? "on-chain transaction failed" : undefined,
        msg: failed ? `${name} failed on-chain` : (SUCCESS_MSG[name] ?? name),
      });
      await pushKeeperLogLine(line);
      pushed += 1;
    }
  }

  return NextResponse.json({ ok: true, received: txs.length, pushed });
}

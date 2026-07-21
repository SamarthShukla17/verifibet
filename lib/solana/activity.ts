/**
 * Recent bet activity for one fixture's market — `getSignaturesForAddress`
 * on the Market PDA (same technique as lib/receipts.ts's resolve-tx scan),
 * then Anchor's `EventParser` over each transaction's logs to pull out
 * `BetPlaced` events. Server-only, read-only.
 *
 * Event names aren't matched against a hardcoded exact string — the same
 * "::"-segment camelCasing quirk documented in lib/solana/program.ts for
 * account names hasn't been independently confirmed for *event* names
 * specifically (a different Anchor coder namespace), so this matches
 * case-insensitively on "betplaced" being present in whatever name the
 * parser actually returns rather than assuming one exact casing.
 */
import * as anchor from "@coral-xyz/anchor";
import type { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { marketPda } from "@/lib/solana/pda";
import { getReadOnlyProgram } from "@/lib/solana/program";
import type { Outcome } from "@/lib/types";

export interface BetActivity {
  signature: string;
  explorerUrl: string;
  slot: number;
  blockTime: number | null;
  user: string;
  outcome: Outcome;
  /** USDC base units, decimal string — see MarketAccountData.pools's doc
   * comment in lib/solana/market.ts for why (u64 can exceed
   * Number.MAX_SAFE_INTEGER; JSON can't carry a bare bigint). */
  amount: string;
}

/** How many of the market's most recent signatures to scan — generous for
 * a demo market's real lifecycle without hammering the RPC on every poll. */
const ACTIVITY_SIGNATURE_SCAN_LIMIT = 25;

export async function fetchRecentBetActivity(fixtureId: number): Promise<BetActivity[]> {
  const program = getReadOnlyProgram();
  const connection = program.provider.connection;
  const [market] = marketPda(program.programId, fixtureId);

  const signatures = await connection.getSignaturesForAddress(market, {
    limit: ACTIVITY_SIGNATURE_SCAN_LIMIT,
  });
  if (signatures.length === 0) return [];

  const parser = new anchor.EventParser(program.programId, program.coder);

  const results = await Promise.all(
    signatures.map(async (sigInfo): Promise<BetActivity | null> => {
      const tx = await connection.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      const logs = tx?.meta?.logMessages;
      if (!logs) return null;

      for (const event of parser.parseLogs(logs)) {
        if (!event.name.toLowerCase().includes("betplaced")) continue;
        const data = event.data as { market: PublicKey; user: PublicKey; outcome: number; amount: BN };
        // Defensive, not paranoid: this signature history is already
        // scoped to `market`'s own account, but a single transaction can
        // reference more than one market in principle.
        if (!data.market.equals(market)) continue;

        return {
          signature: sigInfo.signature,
          explorerUrl: `https://explorer.solana.com/tx/${sigInfo.signature}?cluster=devnet`,
          slot: sigInfo.slot,
          blockTime: sigInfo.blockTime ?? null,
          user: data.user.toBase58(),
          outcome: data.outcome as Outcome,
          amount: data.amount.toString(),
        };
      }
      return null;
    }),
  );

  return results.filter((r): r is BetActivity => r !== null);
}

/**
 * The receipt page's settlement timeline for one market: when it was
 * created, how many bets it collected (and over what real span of
 * time), and how many bettors have claimed so far — one pass over
 * `getSignaturesForAddress(market)` + Anchor's `EventParser`, the same
 * real technique `lib/solana/activity.ts` already uses for the match
 * page's Activity tab, just aggregated across the market's *whole*
 * lifecycle instead of one event kind. Server-only, read-only.
 *
 * Deliberately a separate pass from `lib/receipts.ts#buildReceipt`
 * (which does its own, narrower signature scan just for the resolve
 * tx) rather than folding this into `Receipt` itself — a receipt is
 * the portable, independently-checkable settlement artifact (also
 * consumed by the OG image route and `ProofPanel`); this is page-
 * specific lifecycle chrome that only the receipt page renders.
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { deriveMarket } from "@/lib/solana/pda";
import { getReadOnlyProgram } from "@/lib/solana/program";

/** Generous for a real market's actual lifecycle (init, a handful of
 * bets, lock, resolve, a handful of claims) — not an attempt to be
 * clever about the exact right number, same reasoning as
 * `lib/receipts.ts`'s own scan limit. */
const TIMELINE_SIGNATURE_SCAN_LIMIT = 1000;

export interface MarketTimeline {
  createdAt: number | null;
  createdTxSig: string | null;
  betCount: number;
  /** Unix seconds of the earliest/latest `BetPlaced` this scan found —
   * `null` for both when `betCount` is 0. */
  firstBetAt: number | null;
  lastBetAt: number | null;
  claimCount: number;
}

const EMPTY_TIMELINE: MarketTimeline = {
  createdAt: null,
  createdTxSig: null,
  betCount: 0,
  firstBetAt: null,
  lastBetAt: null,
  claimCount: 0,
};

export async function buildMarketTimeline(fixtureId: number): Promise<MarketTimeline> {
  const program = getReadOnlyProgram();
  const connection = program.provider.connection;
  const [market] = deriveMarket(BigInt(fixtureId));

  const signatures = await connection.getSignaturesForAddress(market, {
    limit: TIMELINE_SIGNATURE_SCAN_LIMIT,
  });
  if (signatures.length === 0) return EMPTY_TIMELINE;

  // `getSignaturesForAddress` returns newest-first; walking oldest-first
  // is what makes "the first one we see with a MarketInitialized event
  // is *the* creation" (and "first"/"last" bet timestamps) correct.
  const chronological = [...signatures].reverse();

  const parser = new anchor.EventParser(program.programId, program.coder);

  let createdAt: number | null = null;
  let createdTxSig: string | null = null;
  let betCount = 0;
  let firstBetAt: number | null = null;
  let lastBetAt: number | null = null;
  let claimCount = 0;

  for (const sigInfo of chronological) {
    const tx = await connection.getTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
    const logs = tx?.meta?.logMessages;
    if (!logs) continue;

    for (const event of parser.parseLogs(logs)) {
      const name = event.name.toLowerCase();
      const data = event.data as { market?: PublicKey };
      // Same defensive check as lib/solana/activity.ts's own doc
      // comment: this signature history is already scoped to `market`,
      // but a single transaction can reference more than one market in
      // principle.
      if (!data.market?.equals(market)) continue;

      if (name.includes("marketinitialized")) {
        if (createdAt === null) {
          createdAt = sigInfo.blockTime ?? null;
          createdTxSig = sigInfo.signature;
        }
      } else if (name.includes("betplaced")) {
        betCount++;
        if (firstBetAt === null) firstBetAt = sigInfo.blockTime ?? null;
        lastBetAt = sigInfo.blockTime ?? null;
      } else if (name.includes("winningsclaimed") || name.includes("refundclaimed")) {
        claimCount++;
      }
    }
  }

  return { createdAt, createdTxSig, betCount, firstBetAt, lastBetAt, claimCount };
}

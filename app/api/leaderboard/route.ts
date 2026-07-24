/**
 * GET /api/leaderboard — every wallet with at least one on-chain `Bet`,
 * aggregated into volume / wins / losses / accuracy / current streak /
 * realized P&L and ranked by P&L, top 50.
 *
 * The aggregation math (`classifyBet`, `computeStreak`, both
 * `lib/parimutuel.ts`) is the *exact same* pure functions
 * `lib/hooks/useMyBets.ts` and `lib/portfolio.ts` use for one connected
 * wallet's own Portfolio page — this route is that identical computation
 * fanned out across every `Bet` account that exists on-chain, not a
 * second implementation that could quietly disagree with a viewer's own
 * numbers for the same wallet.
 *
 * Cached via `lib/cache.ts#readThrough` (60s TTL) under one fixed key —
 * a single global leaderboard, not per-wallet, so there's exactly one
 * cache entry regardless of how many people load this page.
 *
 * **Top 50 only, genuinely** — not just the display layer's truncation.
 * The computed + sorted array is capped at `TOP_N` *before* caching, so
 * a wallet ranked #51+ by P&L has no entry in this response at all. The
 * `/leaderboard` page's own "You" pinning can only ever find a wallet
 * that's actually in this array — a wallet outside the top 50 simply
 * has nothing to pin. That's a real, deliberate limitation of "top 50,
 * cached" as specified, not an oversight; revisit if a future session
 * needs "my rank" to work unconditionally (that would need either an
 * unbounded cached list or a live per-wallet lookup alongside this
 * route, not a change to this route itself).
 *
 * `runtime = "nodejs"` — same reason as every other route here that
 * touches `@coral-xyz/anchor`: it isn't edge-compatible.
 */
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";
import { BET_ACCOUNT_IDL_NAME, MARKET_ACCOUNT_IDL_NAME, getReadOnlyProgram } from "@/lib/solana/program";
import { classifyBet, computeStreak, type SettlementResult } from "@/lib/parimutuel";
import { readThrough } from "@/lib/cache";
import type { MarketStatus, Outcome } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEADERBOARD_CACHE_KEY = "leaderboard:v1";
const LEADERBOARD_TTL_SECONDS = 60;
const TOP_N = 50;

export interface LeaderboardEntry {
  /** 1-based, by realized P&L descending — fixed regardless of how the
   * UI re-sorts its display order across the Volume/Accuracy/Streak
   * tabs (see the module doc comment). */
  rank: number;
  wallet: string;
  /** USDC base units, decimal string (see `MarketAccountData.pools`'s
   * doc comment in `lib/solana/market.ts` for why — u64 can exceed
   * `Number.MAX_SAFE_INTEGER`). Sum of every bet this wallet has ever
   * placed, regardless of status. */
  volume: string;
  wins: number;
  losses: number;
  /** 0-100, one decimal place. `0` (not `NaN`/`null`) when the wallet
   * has no decided (won/lost) bets yet — `wins + losses === 0`. */
  accuracyPct: number;
  streak: number;
  /** USDC base units, decimal string, can be negative — see `volume`'s
   * doc comment for why this crosses the JSON boundary as a string. */
  pnl: string;
}

interface DecodedMarket {
  status: Record<string, unknown>;
  outcome: number;
  pools: [BN, BN, BN];
  totalPool: BN;
  resolvedAt: BN;
}

interface DecodedBet {
  user: PublicKey;
  market: PublicKey;
  outcome: number;
  amount: BN;
  claimed: boolean;
}

function decodeMarketStatus(status: Record<string, unknown>): Lowercase<MarketStatus> {
  return Object.keys(status)[0] as Lowercase<MarketStatus>;
}

interface WalletAgg {
  volume: bigint;
  wins: number;
  losses: number;
  pnl: bigint;
  results: SettlementResult[];
}

async function computeLeaderboard(): Promise<LeaderboardEntry[]> {
  const program = getReadOnlyProgram();
  const betClient = (
    program.account as Record<string, { all(): Promise<{ publicKey: PublicKey; account: DecodedBet }[]> }>
  )[BET_ACCOUNT_IDL_NAME];
  const marketClient = (
    program.account as Record<string, { fetchMultiple(addresses: PublicKey[]): Promise<(DecodedMarket | null)[]> }>
  )[MARKET_ACCOUNT_IDL_NAME];

  const bets = await betClient.all();
  if (bets.length === 0) return [];

  const marketPdaStrings = [...new Set(bets.map((b) => b.account.market.toBase58()))];
  const marketAccounts = await marketClient.fetchMultiple(marketPdaStrings.map((s) => new PublicKey(s)));
  const marketsByPda = new Map(marketPdaStrings.map((s, i) => [s, marketAccounts[i]] as const));

  const byWallet = new Map<string, WalletAgg>();

  for (const bet of bets) {
    const market = marketsByPda.get(bet.account.market.toBase58());
    if (!market) continue; // a Bet PDA only ever exists for a real Market

    const wallet = bet.account.user.toBase58();
    const agg = byWallet.get(wallet) ?? { volume: 0n, wins: 0, losses: 0, pnl: 0n, results: [] };

    const amount = BigInt(bet.account.amount.toString());
    agg.volume += amount; // every bet counts toward volume, regardless of outcome

    const marketStatus = decodeMarketStatus(market.status);
    const { status, payout } = classifyBet(
      { outcome: bet.account.outcome as Outcome, amount, claimed: bet.account.claimed },
      {
        status: marketStatus,
        outcome: market.outcome === 255 ? null : (market.outcome as Outcome),
        pools: market.pools.map((p) => BigInt(p.toString())) as [bigint, bigint, bigint],
        totalPool: BigInt(market.totalPool.toString()),
      },
    );
    const resolvedAt = market.resolvedAt.toNumber();

    // Same win/loss/pnl/streak rules as lib/portfolio.ts's
    // computePortfolioStats — pending and void (refundable, or a
    // refund-claimed position) contribute volume only, never W/L/pnl.
    if (status === "won") {
      agg.wins++;
      agg.pnl += (payout ?? 0n) - amount;
      agg.results.push({ won: true, resolvedAt });
    } else if (status === "lost") {
      agg.losses++;
      agg.pnl -= amount;
      agg.results.push({ won: false, resolvedAt });
    } else if (status === "claimed" && marketStatus !== "voided") {
      agg.wins++;
      agg.pnl += (payout ?? 0n) - amount;
      agg.results.push({ won: true, resolvedAt });
    }

    byWallet.set(wallet, agg);
  }

  const ranked = [...byWallet.entries()]
    .map(([wallet, agg]) => ({ wallet, agg }))
    .sort((a, b) => {
      if (a.agg.pnl === b.agg.pnl) return a.wallet.localeCompare(b.wallet); // deterministic tie-break
      return a.agg.pnl > b.agg.pnl ? -1 : 1;
    })
    .slice(0, TOP_N);

  return ranked.map(({ wallet, agg }, i) => {
    const decided = agg.wins + agg.losses;
    return {
      rank: i + 1,
      wallet,
      volume: agg.volume.toString(),
      wins: agg.wins,
      losses: agg.losses,
      accuracyPct: decided === 0 ? 0 : Math.round((agg.wins / decided) * 1000) / 10,
      streak: computeStreak(agg.results),
      pnl: agg.pnl.toString(),
    };
  });
}

export async function GET() {
  try {
    const entries = await readThrough(LEADERBOARD_CACHE_KEY, LEADERBOARD_TTL_SECONDS, computeLeaderboard);
    return NextResponse.json(
      { entries },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } },
    );
  } catch (err) {
    console.error("[leaderboard] failed to compute", err);
    return NextResponse.json({ message: "Failed to load leaderboard" }, { status: 500 });
  }
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { BET_ACCOUNT_IDL_NAME, MARKET_ACCOUNT_IDL_NAME, getProgram } from "@/lib/solana/program";
import { classifyBet, type SettlementStatus } from "@/lib/parimutuel";
import type { TrackedFixture } from "@/lib/txline/statusTracker";
import type { FixtureStage, FixtureStatus, MarketStatus, Outcome } from "@/lib/types";

/** Re-exported from `lib/parimutuel.ts`'s `SettlementStatus` — kept as
 * its own name here since `Position`-consuming code (`PositionRow`,
 * `lib/portfolio.ts`) predates the shared-classification refactor and
 * reads more naturally as "a position's status" than "a settlement
 * status" at those call sites. Same five values, same meaning — see
 * `classifyBet`'s own doc comment for why they're mutually exclusive and
 * exhaustive. */
export type PositionStatus = SettlementStatus;

export interface Position {
  /** Bet PDA, base58 — stable React key and the eventual `claim_winnings`/
   * `claim_refund` target once that's wired (Phase 6). */
  betPda: string;
  marketPda: string;
  fixtureId: number;
  home: string;
  away: string;
  /** `null` when this fixture isn't in TxLINE's own list (e.g. a
   * synthetic test fixture) — `Market` itself has no `stage` field, only
   * TxLINE's fixture metadata does, so this is enrichment, not something
   * every position is guaranteed to have. */
  stage: FixtureStage | null;
  fixtureStatus: FixtureStatus | null;
  kickoffTs: number;
  marketStatus: MarketStatus;
  /** Unix seconds — `Market.resolved_at`, `0` while unresolved (never
   * set by `void_market`, only `resolve_market` — see that instruction's
   * own doc comment). Used to order streak calculations (`lib/portfolio.ts`,
   * `app/api/leaderboard/route.ts`'s server-side equivalent) by *when*
   * a position was decided, not just *that* it was. */
  resolvedAt: number;
  outcome: Outcome;
  /** Team name (or "Draw") for `outcome` — the one place this label is
   * computed, so PositionRow never re-derives it from raw team strings. */
  pickLabel: string;
  /** USDC base units, 6dp — this position's own stake. */
  amount: bigint;
  status: PositionStatus;
  /** Live "if resolved right now" estimate — only set while `pending`
   * (pools still move until kickoff/lock, see `lib/parimutuel.ts`). */
  estPayout: bigint | null;
  /** The real, exact amount — set for `won` (what claiming would pay),
   * `refundable` (the stake coming back), and `claimed` (what was
   * actually paid, computed the identical way since a resolved market's
   * pools are frozen — see `computePayout`'s own doc comment). `null`
   * for `pending` (no final number exists yet) and `lost` (nothing to
   * claim). */
  payout: bigint | null;
}

export interface UseMyBetsResult {
  /** `null` until the first fetch resolves; `[]` for "no wallet" or
   * "wallet has no positions", both real, non-error states. */
  positions: Position[] | null;
  loading: boolean;
  refresh: () => void;
}

/** Only while at least one position's underlying fixture is genuinely
 * `LIVE` — a settled position's pools/status/outcome never change again,
 * and a not-yet-kicked-off one only changes at its own kickoff, so
 * blindly polling every list of bets on a fixed interval regardless of
 * their state would just be wasted RPC load for the common case (a
 * history of already-resolved or still-far-off positions). */
const POLL_INTERVAL_MS = 20_000;

/** `Bet`'s on-chain layout (see anchor/programs/verifibet/src/state.rs):
 * 8-byte discriminator, then `user: Pubkey` — the same offset
 * `lib/solana/market.ts`'s `fetchBettorCount` slices on, kept here as its
 * own literal (not imported) since that module is server-only and this
 * hook must stay client-safe. */
const BET_USER_OFFSET = 8;

type DecodedMarket = {
  fixtureId: BN;
  home: string;
  away: string;
  kickoffTs: BN;
  status: Record<string, unknown>;
  outcome: number;
  pools: [BN, BN, BN];
  totalPool: BN;
  resolvedAt: BN;
};

type DecodedBet = {
  outcome: number;
  amount: BN;
  claimed: boolean;
};

function pickLabel(outcome: Outcome, home: string, away: string): string {
  return outcome === 0 ? home : outcome === 1 ? "Draw" : away;
}

function decodeMarketStatus(status: Record<string, unknown>): Lowercase<MarketStatus> {
  return Object.keys(status)[0] as Lowercase<MarketStatus>;
}

/**
 * Every `Bet` PDA owned by the connected wallet, joined with its
 * `Market` (fetched in one batched `fetchMultiple` call, not N
 * individual reads) and — best-effort — TxLINE's own fixture metadata
 * for `stage`/live `status` (client-side `fetch("/api/fixtures")`,
 * matching `ActivityTab.tsx`'s own client-fetch pattern; `Market` itself
 * already carries authoritative `home`/`away`/`kickoffTs`, so a missing
 * TxLINE entry — e.g. a synthetic test fixture — degrades to `stage:
 * null` rather than dropping the position).
 *
 * Reads through `getProgram(connection, wallet)` (the same client
 * construction `usePlaceBet` uses for writes) rather than
 * `getReadOnlyProgram()` — this hook is inherently wallet-scoped (no
 * wallet, nothing to query), so there's no point standing up a second,
 * placeholder-keyed `Connection`/`Program` when the real connected one is
 * already in hand.
 */
export function useMyBets(): UseMyBetsResult {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletKey = wallet.publicKey?.toBase58() ?? null;

  // `fetchPositions`'s own identity stays keyed on `walletKey` alone (a
  // plain string), not the `wallet`/`connection` object references —
  // those churn most renders even when nothing meaningful changed, which
  // would otherwise mean either a fresh self-reschedule timer on every
  // render or a `useCallback` that has to close over stale values. Refs
  // sidestep both: always read as of the *call*, not the render that
  // created the closure.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const fetchPositions = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const wallet = walletRef.current;
    const connection = connectionRef.current;

    if (!wallet.publicKey) {
      setPositions([]);
      setLoading(false);
      return;
    }

    try {
      const program = getProgram(connection, wallet);
      const betClient = (
        program.account as Record<
          string,
          { all(filters: unknown[]): Promise<{ publicKey: PublicKey; account: DecodedBet & { market: PublicKey } }[]> }
        >
      )[BET_ACCOUNT_IDL_NAME];
      const marketClient = (
        program.account as Record<string, { fetchMultiple(addresses: PublicKey[]): Promise<(DecodedMarket | null)[]> }>
      )[MARKET_ACCOUNT_IDL_NAME];

      const bets = await betClient.all([
        { memcmp: { offset: BET_USER_OFFSET, bytes: wallet.publicKey.toBase58() } },
      ]);

      if (bets.length === 0) {
        setPositions([]);
        setLoading(false);
        return;
      }

      const marketPdaStrings = [...new Set(bets.map((b) => b.account.market.toBase58()))];
      const marketAccounts = await marketClient.fetchMultiple(
        marketPdaStrings.map((s) => new PublicKey(s)),
      );
      const marketsByPda = new Map(marketPdaStrings.map((s, i) => [s, marketAccounts[i]] as const));

      // Best-effort enrichment only — see doc comment above. A failed
      // fetch just means every position's `stage`/`fixtureStatus` comes
      // back `null` instead of blocking the whole hook.
      let fixturesById = new Map<number, TrackedFixture>();
      try {
        const res = await fetch("/api/fixtures", { cache: "no-store" });
        const fixtures: TrackedFixture[] = await res.json();
        fixturesById = new Map(fixtures.map((f) => [f.fixtureId, f]));
      } catch {
        // enrichment only — see doc comment above
      }

      const built: Position[] = [];
      for (const bet of bets) {
        const market = marketsByPda.get(bet.account.market.toBase58());
        if (!market) continue; // a Bet PDA only ever exists for a real Market

        const fixtureId = market.fixtureId.toNumber();
        const fixture = fixturesById.get(fixtureId);
        const home = fixture?.home ?? market.home;
        const away = fixture?.away ?? market.away;
        const outcome = bet.account.outcome as Outcome;
        const amount = BigInt(bet.account.amount.toString());
        const marketStatus = decodeMarketStatus(market.status);
        const { status, estPayout, payout } = classifyBet(
          { outcome, amount, claimed: bet.account.claimed },
          {
            status: marketStatus,
            outcome: market.outcome === 255 ? null : (market.outcome as Outcome),
            pools: market.pools.map((p) => BigInt(p.toString())) as [bigint, bigint, bigint],
            totalPool: BigInt(market.totalPool.toString()),
          },
        );

        built.push({
          betPda: bet.publicKey.toBase58(),
          marketPda: bet.account.market.toBase58(),
          fixtureId,
          home,
          away,
          stage: fixture?.stage ?? null,
          fixtureStatus: fixture?.status ?? null,
          kickoffTs: market.kickoffTs.toNumber(),
          marketStatus: marketStatus.toUpperCase() as MarketStatus,
          resolvedAt: market.resolvedAt.toNumber(),
          outcome,
          pickLabel: pickLabel(outcome, home, away),
          amount,
          status,
          estPayout,
          payout,
        });
      }

      // Soonest-kickoff-first within an otherwise stable order — a
      // pending/live position is exactly the one a viewer most wants to
      // find at the top of their own bet list.
      built.sort((a, b) => a.kickoffTs - b.kickoffTs);

      setPositions(built);
      setLoading(false);

      if (built.some((p) => p.fixtureStatus === "LIVE")) {
        timerRef.current = setTimeout(() => void fetchPositions(), POLL_INTERVAL_MS);
      }
    } catch {
      // Transient RPC hiccup — keep last-known-good positions on screen
      // rather than clearing them, same "stale beats blank" philosophy as
      // useMarketAccount.ts.
      setLoading(false);
    }
  }, [walletKey]);

  useEffect(() => {
    setLoading(true);
    void fetchPositions();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [walletKey, fetchPositions]);

  return { positions, loading, refresh: fetchPositions };
}

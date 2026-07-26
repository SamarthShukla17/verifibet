/**
 * Auto-resolution for demo-range markets (Session/Phase 7 exit) — the
 * keeper-side half of making the recorded demo path genuinely automatic:
 * presenter jumps the replay to Full-time, and within ~60s the on-chain
 * market resolves with no further clicks, the same "keeper handles it"
 * story the real fixture path already tells.
 *
 * ## Why this can't go through `resolve_market`'s real CPI
 *
 * `resolve_market` only ever succeeds against TxLINE's genuine
 * Merkle-anchored data (see `resolve_market.rs`'s module doc comment) —
 * TxLINE has never heard of a demo-range fixture id (`+9,000,000`, see
 * `lib/txline/demoScenarios.ts#DEMO_FIXTURE_OFFSET`), so there is no
 * proof to submit. This module uses `resolve_market_attested` instead —
 * compiled in via `--features manual-fallback` (see
 * `anchor/programs/verifibet/src/instructions/resolve_market.rs`'s own
 * doc comment on that instruction, which explicitly anticipates and
 * requires disclosure for exactly this kind of use) — with an `outcome`
 * derived the *same honest way* `keeper/resolver.ts` derives it for real
 * fixtures (`deriveOutcome` against a real `game_finalised`-shaped
 * event), just read from the demo scenario's own committed
 * `.rest.json` data instead of a live TxLINE call, and a `proof_hash`
 * that's an honest local commitment to that data — never a fabricated
 * stand-in for a real Merkle proof. **Disclosed in README.md's
 * "Reproducing the demo environment" section, per that instruction's own
 * requirement**: every demo-range market, always, is resolved this way —
 * never a real market.
 *
 * ## Why this needs to poll the *app*, not TxLINE or its own tracker
 *
 * `keeper/index.ts`'s own `StatusTracker` only reflects live state for
 * fixtures *this process* subscribes to — for demo fixtures, that live
 * state exists only inside the Next.js dev server process actually
 * running the presenter's replay (`lib/txline/stream.ts`'s
 * `TxlineStreamManager`, gated on that process's own `DEMO_MODE`/replay
 * position, `globalThis`-scoped to it alone). The keeper is a *separate*
 * process with no visibility into that in-memory state — so this module
 * polls the running app's own `GET /api/fixtures` over HTTP (the same
 * endpoint the browser's UI reads), the one place a demo fixture's real,
 * presenter-driven live status is actually exposed.
 */
import { sendAndConfirmTransaction } from "@solana/web3.js";

import { deriveMarket } from "@/lib/solana/pda";
import { fetchMarketStatus, formatTxError, type KeeperContext } from "@/keeper/jobs";
import { deriveOutcome, toFixture, toScoreEvent } from "@/lib/txline/normalize";
import { demoProofHash, loadDemoScenarios, type DemoScenario } from "@/lib/txline/demoScenarios";
import type { FixtureStatus } from "@/lib/types";

/** Matches `lib/hooks/useLiveFixture.ts`'s own `TrackedFixture`-shaped
 * response from `GET /api/fixtures` — only the fields this module reads. */
interface LiveFixtureStatus {
  fixtureId: number;
  status: FixtureStatus;
}

function resolveAppBaseUrl(): string {
  return process.env.KEEPER_APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Every registered demo scenario's *live* tracked status, straight from
 * the running app — `null` (not thrown) on any fetch failure, so a dev
 * server that's momentarily down/restarting just means "nothing to do
 * this tick", not a keeper crash. */
export async function pollLiveDemoFixtureStatuses(): Promise<Map<number, FixtureStatus> | null> {
  const scenarios = loadDemoScenarios();
  if (scenarios.length === 0) return new Map();

  try {
    const res = await fetch(`${resolveAppBaseUrl()}/api/fixtures`);
    if (!res.ok) return null;
    const fixtures = (await res.json()) as LiveFixtureStatus[];
    const demoIds = new Set(scenarios.map((s) => s.meta.demoFixtureId));
    const byId = new Map<number, FixtureStatus>();
    for (const f of fixtures) {
      if (demoIds.has(f.fixtureId)) byId.set(f.fixtureId, f.status);
    }
    return byId;
  } catch {
    return null;
  }
}

/**
 * The real `game_finalised`-derived outcome for a demo scenario, read
 * from its own already-committed `.rest.json` `scores` — the exact same
 * `toScoreEvent`/`deriveOutcome` pipeline `keeper/resolver.ts` uses for
 * real fixtures, just sourced locally instead of from a live TxLINE call.
 * Throws if the scenario has no `game_finalised` event at all — true for
 * `final-preview` (deliberately pre-match-only, see its own doc comment
 * in `scripts/build-demo-scenario.ts`), which is never resolvable and
 * never should be.
 */
function deriveDemoOutcome(scenario: DemoScenario) {
  const finalEvent = scenario.scores.find((e) => e.Action === "game_finalised");
  if (!finalEvent) {
    throw new Error(`scenario "${scenario.meta.scenario}" has no game_finalised event — not resolvable`);
  }
  const scoreEvent = toScoreEvent(finalEvent);
  if (!scoreEvent) {
    throw new Error(`scenario "${scenario.meta.scenario}"'s game_finalised event carries no Score data`);
  }
  const stage = toFixture(scenario.fixture).stage;
  return { outcome: deriveOutcome(scoreEvent, stage), scoreEvent };
}

export interface DemoResolveResult {
  action: "resolved" | "skipped";
  status?: string;
  outcome?: number;
  txSig?: string;
}

/** Idempotent the same way every other keeper job is — re-reads on-chain
 * status first, no-ops (`"skipped"`) unless it's still `Open`/`Locked`. */
export async function resolveDemoFixtureJob(ctx: KeeperContext, fixtureId: number): Promise<DemoResolveResult> {
  const scenario = loadDemoScenarios().find((s) => s.meta.demoFixtureId === fixtureId);
  if (!scenario) {
    throw new Error(`fixture ${fixtureId} is not a registered demo-range fixture`);
  }

  const [market] = deriveMarket(BigInt(fixtureId));
  const status = await fetchMarketStatus(ctx.program, market);
  if (status === null) {
    throw new Error(`market for fixture ${fixtureId} does not exist on-chain yet`);
  }
  if (status !== "open" && status !== "locked") {
    return { action: "skipped", status };
  }

  const { outcome, scoreEvent } = deriveDemoOutcome(scenario);
  const proofHash = demoProofHash(scenario.meta.scenario, fixtureId, outcome, scoreEvent.home, scoreEvent.away);

  const tx = await ctx.program.methods
    .resolveMarketAttested(outcome, Array.from(proofHash))
    .accountsStrict({ authority: ctx.keeper.publicKey, market })
    .transaction();
  tx.feePayer = ctx.keeper.publicKey;

  try {
    const txSig = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.keeper], { commitment: "confirmed" });
    return { action: "resolved", status, outcome, txSig };
  } catch (err) {
    throw new Error(formatTxError(err));
  }
}

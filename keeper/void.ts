/**
 * `void_market` — the escape hatch for a fixture `resolve_market` will
 * never have anything to prove against: TxLINE itself reports the
 * fixture `POSTPONED`/`CANCELLED` (a real, documented `FixtureStatus` —
 * see `lib/txline/normalize.ts`'s doc comment on `fixtureStatusFromActionAndStatusId`:
 * "never observed from real data" so far in this app's captured samples,
 * but real values TxLINE's API can report and this whole pipeline already
 * type-supports), or kickoff passed more than a day ago and the fixture
 * never reached `FINISHED` at all (TxLINE simply never produced a final
 * result — a stalled feed, an abandoned match with no `game_finalised`
 * event, ...). Either way there's no score to resolve against, so
 * `void_market` marks the market `Voided` instead, giving every bettor
 * their exact stake back via `claim_refund` (see
 * `anchor/programs/verifibet/src/instructions/void_and_refund.rs`) rather
 * than leaving funds stuck in the vault forever.
 *
 * `isVoidCandidate`'s "24h past kickoff" threshold mirrors
 * `void_and_refund.rs`'s own on-chain `VOID_GRACE_PERIOD_SECS` (86,400s,
 * the non-`test-mock-txline` value — this keeper only ever runs against a
 * real devnet/mainnet build) exactly, so a POSTPONED/CANCELLED fixture
 * candidate and a plain-timeout candidate converge on the identical
 * on-chain guard either way: `void_market` itself unconditionally
 * requires `now > kickoff_ts + VOID_GRACE_PERIOD_SECS` regardless of
 * *why* the keeper is attempting it (there's no separate on-chain fast
 * path for "TxLINE told us it's cancelled"). Checking the same threshold
 * client-side isn't redundant paranoia, it's what keeps a freshly
 * `POSTPONED` fixture (which could be minutes past its original kickoff)
 * from producing a wasted `TooEarlyToVoid` transaction attempt every tick
 * until the real 24h passes.
 */
import { sendAndConfirmTransaction } from "@solana/web3.js";

import { deriveMarket } from "@/lib/solana/pda";
import type { FixtureStatus } from "@/lib/types";
import { fetchMarketStatus, formatTxError, type KeeperContext } from "@/keeper/jobs";

/** Matches `void_and_refund.rs`'s `VOID_GRACE_PERIOD_SECS` (see that
 * file's own doc comment for why it's a full day: an authority — even a
 * trusted keeper — shouldn't be able to void a market that's simply still
 * in-flight to dodge a resolution). */
const VOID_GRACE_PERIOD_SECS = 86_400;

/** Off-chain "is this fixture worth attempting `void_market` for right
 * now" predicate — `keeper/index.ts`'s `reconcile()` calls this against
 * every tracked fixture each tick, the same way it already checks
 * `LIVE`/`FINISHED` for lock/resolve candidates. A `FINISHED` fixture is
 * never a candidate (that's `resolveFixture`'s job); `POSTPONED`/`CANCELLED`
 * always are (subject to the same grace period `voidMarketJob` re-checks
 * on-chain); anything else only qualifies once genuinely a day past its
 * own kickoff with no result. */
export function isVoidCandidate(
  fixture: { status: FixtureStatus; kickoffTs: number },
  nowSeconds: number,
): boolean {
  if (fixture.status === "FINISHED") return false;
  if (fixture.status === "POSTPONED" || fixture.status === "CANCELLED") return true;
  return nowSeconds > fixture.kickoffTs + VOID_GRACE_PERIOD_SECS;
}

export interface VoidJobResult {
  action: "voided" | "skipped";
  status: string;
  txSig?: string;
}

/**
 * `void_market` — re-reads the market's on-chain status first, same
 * idempotency rule as `lockMarketJob`/`resolveFixture`: anything other
 * than `Open`/`Locked` (already `Voided` by a prior attempt, or somehow
 * `Resolved`) is a no-op `"skipped"` result, not an error, so a keeper
 * restart replaying a void candidate never double-acts. A genuinely
 * too-early attempt (the on-chain `TooEarlyToVoid` guard, reached only if
 * `isVoidCandidate`'s own client-side check was somehow satisfied but the
 * real chain clock disagrees — e.g. a `POSTPONED` fixture right at the
 * edge of the window) surfaces as a normal thrown error the retry queue's
 * backoff handles like any other transient failure.
 */
export async function voidMarketJob(ctx: KeeperContext, fixtureId: number): Promise<VoidJobResult> {
  const [market] = deriveMarket(BigInt(fixtureId));
  const status = await fetchMarketStatus(ctx.program, market);

  if (status === null) {
    throw new Error(`market for fixture ${fixtureId} does not exist on-chain yet`);
  }
  if (status !== "open" && status !== "locked") {
    return { action: "skipped", status };
  }

  const tx = await ctx.program.methods
    .voidMarket()
    .accountsStrict({ authority: ctx.keeper.publicKey, market })
    .transaction();
  tx.feePayer = ctx.keeper.publicKey;

  try {
    const txSig = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.keeper], {
      commitment: "confirmed",
    });
    return { action: "voided", status, txSig };
  } catch (err) {
    throw new Error(formatTxError(err));
  }
}

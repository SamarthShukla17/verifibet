/**
 * Fetches and normalizes a TxLINE Merkle proof for a finished fixture's
 * full-time result — turns TxLINE's raw 3-level proof response
 * (`proof.sample.json` at the repo root is a *real* captured response,
 * not synthetic — see below) into a shape the keeper can persist and
 * hand straight to `resolve_market`'s CPI (see
 * `anchor/programs/verifibet/src/instructions/resolve_market.rs`)
 * without re-deriving anything at settlement time.
 *
 * ## Which `statKey` means what — empirically confirmed, not guessed
 *
 * TxLINE's own docs call `ScoreStat.key` opaque (`resolve_market.rs`'s
 * doc comment: "nothing in the IDL documents which key means home team
 * goals vs away team goals"). This was pinned down by cross-referencing
 * three real finished fixtures' `game_finalised` `Stats` dicts against
 * their independently-known real final scores:
 *
 * - Brazil 1 - Norway 2 (R16, `scores.sample.json`)
 * - Germany 1 - Paraguay 1 FT+ET (R32, `scores-r32-paraguay-germany.sample.json`)
 * - Argentina 3 - Cape Verde 2 FT+ET (R32, `scores-r32-argentina-capeverde.sample.json`)
 *
 * Intersecting "which stat key equals the home team's actual goal count"
 * across all three narrows to exactly one key: `1`. Same for away, which
 * narrows to `2`. (Full working shown in NOTES.md.) Confirmed live
 * afterward against a real `/api/scores/stat-validation` call for Brazil
 * v Norway — `proof.sample.json`'s `statToProve` is `{key:1, value:1,
 * period:100}` (Brazil, home, 1 goal) and `statToProve2` is `{key:2,
 * value:2, period:100}` (Norway, away, 2 goals). Matches exactly.
 * `period: 100` is TxODDS's documented code for a finalised full-time
 * result (see `resolve_market.rs`'s `FULL_TIME_PERIOD`).
 *
 * ## Normalization choices — what's real data vs. what's this module's own
 *
 * - `leaf`, `path`, and `root` are now all real, verifiable data —
 *   `lib/txline/verify.ts` empirically determined and cross-confirmed
 *   TxLINE's leaf-hashing algorithm and sibling-combination rule against
 *   this exact `proof.sample.json` (Borsh-LE-encode `{key, value,
 *   period}` -> sha256 -> leaf; combine with each proof node via
 *   `isRightSibling`-ordered concat -> sha256). `leafHash` below uses
 *   that confirmed algorithm; see `verify.ts`'s module doc comment for
 *   the full derivation and passing test vector.
 * - `root` is `summary.eventStatsSubTreeRoot`, and `path` is
 *   *exactly* `statProof` then `subTreeProof` — deliberately **not**
 *   including `mainTreeProof`, even though it's a real part of TxLINE's
 *   proof chain (see `meta.proof.mainTree`). Combining `path` with
 *   `mainTreeProof` climbs one Merkle level *past* `root` to the true
 *   on-chain-anchored value (`daily_scores_roots`) — which TxLINE's API
 *   never returns as a named field to check against, only implies. Since
 *   `verifyProof(leaf, path, root)` needs `path` to climb to *exactly*
 *   `root` for a correct proof to verify `true`, `path`/`root` here are
 *   kept as the one sub-chain that's actually a self-consistent,
 *   checkable pair. `mainTreeProof` is real data, not discarded — it's
 *   just not part of what this module calls "the" provable path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getScores, getValidationProof } from "@/lib/txline/client";
import { readThrough, PROOF_TTL_SECONDS } from "@/lib/cache";
import { hashLeaf, type ProofStep } from "@/lib/txline/verify";
import type { TxProofNode, TxScoresStatValidation } from "@/lib/txline/types";

export type StatKind = "FT_RESULT";

const STAT_KIND_KEYS: Record<StatKind, { statKey: number; statKey2: number }> = {
  // Empirically confirmed above: 1 = home goals, 2 = away goals.
  FT_RESULT: { statKey: 1, statKey2: 2 },
};

/** TxODDS's documented code for a finalised full-time result (regulation,
 * extra time, penalties, and abandoned matches all use this same code) —
 * see `resolve_market.rs`'s `FULL_TIME_PERIOD`. */
const FULL_TIME_PERIOD = 100;

export interface NormalizedProof {
  fixtureId: number;
  statKind: StatKind;
  /** Signed goal difference, home - away — exactly what `resolve_market.rs`'s
   * `Subtract` op + outcome predicate evaluate on-chain. */
  value: number;
  /** hex leaf hash of the home stat's pre-image — see `lib/txline/verify.ts`'s
   * `hashLeaf` for the (empirically confirmed, not assumed) algorithm. */
  leaf: string;
  /** The real proof chain, `statProof` then `subTreeProof` — feed this and
   * `leaf` into `lib/txline/verify.ts`'s `verifyProof` and it recomputes to
   * exactly `root`. Deliberately excludes `mainTreeProof`; see the module
   * doc comment's "Normalization choices" section for why. */
  path: ProofStep[];
  /** `summary.eventStatsSubTreeRoot`, hex — see the module doc comment
   * for why this isn't the final on-chain-anchored root. */
  root: string;
  meta: {
    /** ms, TxLINE's own response timestamp. */
    ts: number;
    /** The scores-event sequence number this proof is for — the
     * `game_finalised` event, discovered automatically by `fetchProof`. */
    seq: number;
    period: number;
    home: { statKey: number; value: number; leaf: string };
    away: { statKey: number; value: number; leaf: string };
    eventStatRoot: string;
    eventStatsSubTreeRoot: string;
    proof: {
      stat: ProofStep[];
      stat2: ProofStep[];
      subTree: ProofStep[];
      mainTree: ProofStep[];
    };
    /** The full, untouched raw response — for anything this normalized
     * shape doesn't happen to expose. */
    raw: TxScoresStatValidation;
  };
}

function toHex(bytes: number[]): string {
  return Buffer.from(bytes).toString("hex");
}

function toProofSteps(nodes: TxProofNode[]): ProofStep[] {
  return nodes.map((n) => ({ hash: toHex(n.hash), isRightSibling: n.isRightSibling }));
}

/** Exported for `lib/txline/proofs.test.ts` — pure, no network/fs/cache
 * side effects, so it's tested directly against `proof.sample.json`
 * rather than through the full `fetchProof` (which would need mocking
 * three different I/O boundaries for no extra coverage). */
export function normalize(fixtureId: number, statKind: StatKind, seq: number, raw: TxScoresStatValidation): NormalizedProof {
  if (!raw.statToProve2) {
    throw new Error(
      `getValidationProof for fixture ${fixtureId} seq ${seq} returned no statToProve2 — ${statKind} needs both home and away stats`,
    );
  }

  const home = raw.statToProve;
  const away = raw.statToProve2;
  const homeLeaf = hashLeaf(home);
  const awayLeaf = hashLeaf(away);

  const path = [...toProofSteps(raw.statProof), ...toProofSteps(raw.subTreeProof)];

  return {
    fixtureId,
    statKind,
    value: home.value - away.value,
    leaf: homeLeaf,
    path,
    root: toHex(raw.summary.eventStatsSubTreeRoot),
    meta: {
      ts: raw.ts,
      seq,
      period: home.period,
      home: { statKey: home.key, value: home.value, leaf: homeLeaf },
      away: { statKey: away.key, value: away.value, leaf: awayLeaf },
      eventStatRoot: toHex(raw.eventStatRoot),
      eventStatsSubTreeRoot: toHex(raw.summary.eventStatsSubTreeRoot),
      proof: {
        stat: toProofSteps(raw.statProof),
        stat2: toProofSteps(raw.statProof2 ?? []),
        subTree: toProofSteps(raw.subTreeProof),
        mainTree: toProofSteps(raw.mainTreeProof),
      },
      raw,
    },
  };
}

const PROOFS_DIR = join(process.cwd(), "proofs");

/** `proofs/<fixtureId>.json`, gitignored — the keeper reads straight from
 * disk at resolve time rather than re-fetching over the network, since a
 * finished fixture's proof never changes (see `PROOF_TTL_SECONDS`). */
function persistLocally(proof: NormalizedProof): void {
  mkdirSync(PROOFS_DIR, { recursive: true });
  const path = join(PROOFS_DIR, `${proof.fixtureId}.json`);
  writeFileSync(path, JSON.stringify(proof, null, 2) + "\n");
  console.log(`[proofs] wrote ${path}`);
}

/**
 * Fetches (or returns the already-cached) normalized proof for a
 * finished fixture's `statKind` (only `'FT_RESULT'` today). Finds the
 * fixture's `game_finalised` scores event automatically — TxLINE's own
 * docs are explicit that settlement proofs should be built from that
 * exact event, not an arbitrary in-running one (see
 * `documentation/examples/onchain-validation.mdx` in
 * `github.com/txodds/tx-on-chain`) — so callers never need to know or
 * supply a `seq` themselves.
 *
 * Persists to both Upstash (`proof:<fixtureId>`, no expiry — see
 * `lib/cache.ts`) and `proofs/<fixtureId>.json` on disk (gitignored)
 * every time it runs, regardless of whether the Redis half was a hit or
 * a fresh fetch, so the local copy is always current for the keeper.
 * `proof:<fixtureId>` (not `proof:<fixtureId>:<statKind>`) is a
 * deliberate simplification matching this task's literal spec — safe
 * today since `'FT_RESULT'` is the only `statKind` implemented; would
 * need a `statKind` suffix if a second one is ever added, same caveat as
 * `lib/txline/client.ts`'s `fixtures:all` key.
 */
export async function fetchProof(
  fixtureId: number,
  statKind: StatKind = "FT_RESULT",
): Promise<NormalizedProof> {
  const proof = await readThrough(`proof:${fixtureId}`, PROOF_TTL_SECONDS, async () => {
    const events = await getScores(fixtureId);
    const finalised = events.filter((e) => e.Action === "game_finalised");
    if (finalised.length === 0) {
      throw new Error(
        `fixture ${fixtureId} has no game_finalised scores event yet — fetchProof only works for finished matches`,
      );
    }
    const latest = finalised.reduce((a, b) => (b.Seq > a.Seq ? b : a));
    if (latest.StatusId !== undefined && latest.StatusId !== FULL_TIME_PERIOD) {
      console.warn(
        `[proofs] fixture ${fixtureId}'s game_finalised event has StatusId ${latest.StatusId}, not ${FULL_TIME_PERIOD} — proceeding anyway (Action is the reliable signal, see lib/txline/normalize.ts)`,
      );
    }

    const { statKey, statKey2 } = STAT_KIND_KEYS[statKind];
    const raw = await getValidationProof(fixtureId, latest.Seq, statKey, statKey2);
    return normalize(fixtureId, statKind, latest.Seq, raw);
  });

  persistLocally(proof);
  return proof;
}

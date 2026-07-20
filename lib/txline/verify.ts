/**
 * Recomputes a Merkle root from a leaf + proof path and compares it to
 * the published root — pure, synchronous, isomorphic (no Node-only
 * APIs; `@noble/hashes` is pure JS, identical in a browser and in Node).
 * This is the entire "Verify in your browser" button: fetch a persisted
 * proof from anywhere (this app's own API, a pasted JSON blob,
 * `proofs/<id>.json`), call `verifyProof`, done — no server round-trip,
 * no trusting this app's own backend to have checked it honestly.
 *
 * ## The hash + combination rule — determined empirically, not assumed
 *
 * TxLINE documents neither the leaf pre-image encoding nor the
 * sibling-combination convention anywhere — `resolve_market.rs`'s own
 * doc comment calls even the stat *key* opaque, let alone how a leaf
 * gets hashed. Found by brute-forcing candidates (sha256 vs keccak256;
 * Borsh-LE vs Borsh-BE vs JSON vs CSV leaf encodings; positional
 * `isRightSibling`-ordered concat vs sorted-pair combination) against
 * `proof.sample.json` — a real captured `/api/scores/stat-validation`
 * response for fixture `18187298` (Brazil v Norway, R16) — until the
 * recomputed value matched the response's own real `eventStatRoot`.
 * Exactly one combination worked:
 *
 * - **Leaf pre-image**: `{key, value, period}` Borsh-encoded as
 *   `u32-LE + i32-LE + i32-LE` (12 bytes) — not JSON, not big-endian,
 *   not a delimited string; all tried and rejected. Matches the natural
 *   choice for a Solana/Anchor-native system (the on-chain `ScoreStat`
 *   Rust struct Borsh-encodes this way by construction).
 * - **Hash function**: sha256 — matches the same primitive
 *   `anchor_lang::solana_program::hash::hash` uses elsewhere in this
 *   codebase (`resolve_market.rs`'s own `market.proof_hash`
 *   computation). keccak256 was tried and rejected.
 * - **Sibling combination**: `isRightSibling` says which side the proof
 *   node goes on when concatenating with the running hash before
 *   hashing again: `step.isRightSibling ? sha256(current ++ sibling) :
 *   sha256(sibling ++ current)`. A sorted-pair rule (order by byte
 *   value, ignoring `isRightSibling` entirely) was also tried and
 *   rejected — it happens to agree with positional ordering on some
 *   nodes in this vector but diverges on others and never reaches the
 *   real root.
 *
 * ## The passing test vector (see `lib/txline/verify.test.ts` for the full assertions)
 *
 * `proof.sample.json`'s home stat (`{key:1, value:1, period:100}`,
 * Brazil's full-time goal count) with its real 4-node `statProof`
 * recomputes to *exactly* the response's own `eventStatRoot`
 * (`32aa0d2d927f9bb71625c628580d5f6c8e032dd414076de207588c2892196d47`).
 * Cross-checked three independent ways, not just the one match:
 *
 * 1. The away stat (`{key:2, value:2, period:100}`, Norway) with its own
 *    `statProof2` recomputes to the *same* `eventStatRoot` — both stats
 *    genuinely share one event's sub-tree, matching the API's own
 *    documented 3-level structure.
 * 2. `eventStatRoot` + `subTreeProof` (1 node) recomputes to the
 *    response's own `summary.eventStatsSubTreeRoot` — the same rule
 *    holds a level up the tree, not just coincidentally at the leaf.
 * 3. `statProof[0]` (home's first, right-hand sibling) is *literally*
 *    the away leaf's own computed hash, and `statProof2[0]` (away's
 *    first, left-hand sibling) is literally the home leaf's hash — the
 *    two stats are directly neighboring leaves in the tree, which is
 *    only possible if this leaf-hashing algorithm is the one that
 *    actually produced those real sibling values TxLINE returned.
 */
import { sha256 } from "@noble/hashes/sha2.js";

/** One step of a Merkle proof: the sibling's hash (hex) and which side
 * it belongs on when combined with the running hash. */
export interface ProofStep {
  hash: string;
  isRightSibling: boolean;
}

export interface StatPreimage {
  key: number;
  value: number;
  period: number;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex string: "${hex}"`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Borsh-LE-encodes `{key, value, period}` (u32 + i32 + i32, 12 bytes)
 * and sha256-hashes it — the leaf rule derived above. `value` is
 * written as a signed i32 (a goal count is never negative in practice,
 * but this mirrors the on-chain `ScoreStat.value: i32` type it
 * pre-images, not a domain assumption about the number's sign).
 */
export function hashLeaf(stat: StatPreimage): string {
  const buf = new DataView(new ArrayBuffer(12));
  buf.setUint32(0, stat.key >>> 0, true);
  buf.setInt32(4, stat.value | 0, true);
  buf.setInt32(8, stat.period | 0, true);
  return bytesToHex(sha256(new Uint8Array(buf.buffer)));
}

function combineStep(current: Uint8Array, step: ProofStep): Uint8Array {
  const sibling = hexToBytes(step.hash);
  return step.isRightSibling
    ? sha256(concatBytes(current, sibling))
    : sha256(concatBytes(sibling, current));
}

/**
 * Walks `leaf` (hex) up through `path` (ordered leaf-to-root) applying
 * the discovered combination rule, and checks the result against `root`
 * (hex). Deliberately simple, straight-line code — one loop, one
 * comparison, no early-exit cleverness, no caching, nothing that could
 * hide a subtle bug in something this security-relevant.
 */
export function verifyProof(leaf: string, path: ProofStep[], root: string): boolean {
  let current = hexToBytes(leaf);
  for (const step of path) {
    current = combineStep(current, step);
  }
  return bytesToHex(current) === root.toLowerCase();
}

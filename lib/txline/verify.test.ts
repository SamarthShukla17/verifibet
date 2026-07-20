import { describe, expect, it } from "vitest";
import proofSample from "@/proof.sample.json";
import { hashLeaf, verifyProof, type ProofStep } from "@/lib/txline/verify";
import { normalize } from "@/lib/txline/proofs";
import type { TxScoresStatValidation } from "@/lib/txline/types";

function toHex(bytes: number[]): string {
  return Buffer.from(bytes).toString("hex");
}
function toProofSteps(nodes: { hash: number[]; isRightSibling: boolean }[]): ProofStep[] {
  return nodes.map((n) => ({ hash: toHex(n.hash), isRightSibling: n.isRightSibling }));
}

const raw = proofSample as TxScoresStatValidation;

describe("verifyProof — real golden vector (proof.sample.json, fixture 18187298, Brazil v Norway)", () => {
  it("recomputes eventStatRoot from the home stat's leaf + statProof", () => {
    const leaf = hashLeaf(raw.statToProve);
    const path = toProofSteps(raw.statProof);
    const root = toHex(raw.eventStatRoot);

    expect(verifyProof(leaf, path, root)).toBe(true);
  });

  it("recomputes the SAME eventStatRoot from the away stat's leaf + statProof2 — both stats share one event sub-tree", () => {
    const leaf = hashLeaf(raw.statToProve2!);
    const path = toProofSteps(raw.statProof2!);
    const root = toHex(raw.eventStatRoot);

    expect(verifyProof(leaf, path, root)).toBe(true);
  });

  it("recomputes summary.eventStatsSubTreeRoot from eventStatRoot + subTreeProof — same rule, one level up", () => {
    const leaf = toHex(raw.eventStatRoot);
    const path = toProofSteps(raw.subTreeProof);
    const root = toHex(raw.summary.eventStatsSubTreeRoot);

    expect(verifyProof(leaf, path, root)).toBe(true);
  });

  it("recomputes the full home-stat path (statProof + subTreeProof) straight to eventStatsSubTreeRoot", () => {
    const leaf = hashLeaf(raw.statToProve);
    const path = [...toProofSteps(raw.statProof), ...toProofSteps(raw.subTreeProof)];
    const root = toHex(raw.summary.eventStatsSubTreeRoot);

    expect(verifyProof(leaf, path, root)).toBe(true);
  });

  it("cross-check: home and away are literally neighboring leaves — statProof[0] IS the away leaf hash, and vice versa", () => {
    const homeLeaf = hashLeaf(raw.statToProve);
    const awayLeaf = hashLeaf(raw.statToProve2!);

    expect(raw.statProof[0].isRightSibling).toBe(true); // home's leaf is on the left
    expect(toHex(raw.statProof[0].hash)).toBe(awayLeaf);

    expect(raw.statProof2![0].isRightSibling).toBe(false); // away's leaf is on the right
    expect(toHex(raw.statProof2![0].hash)).toBe(homeLeaf);
  });

  it("works end-to-end through lib/txline/proofs.ts's own normalize() output — the real integration point", () => {
    const proof = normalize(18187298, "FT_RESULT", 1100, raw);
    expect(verifyProof(proof.leaf, proof.path, proof.root)).toBe(true);
  });
});

describe("verifyProof — negative cases", () => {
  it("fails when the leaf is mutated (wrong value)", () => {
    const mutatedLeaf = hashLeaf({ ...raw.statToProve, value: raw.statToProve.value + 1 });
    const path = toProofSteps(raw.statProof);
    const root = toHex(raw.eventStatRoot);

    expect(verifyProof(mutatedLeaf, path, root)).toBe(false);
  });

  it("fails when a proof step's hash is mutated", () => {
    const leaf = hashLeaf(raw.statToProve);
    const path = toProofSteps(raw.statProof);
    path[0] = { ...path[0], hash: "00".repeat(32) };
    const root = toHex(raw.eventStatRoot);

    expect(verifyProof(leaf, path, root)).toBe(false);
  });

  it("fails when a proof step's sidedness (isRightSibling) is flipped", () => {
    const leaf = hashLeaf(raw.statToProve);
    const path = toProofSteps(raw.statProof);
    path[0] = { ...path[0], isRightSibling: !path[0].isRightSibling };
    const root = toHex(raw.eventStatRoot);

    expect(verifyProof(leaf, path, root)).toBe(false);
  });

  it("fails against a root from a different fixture/level", () => {
    const leaf = hashLeaf(raw.statToProve);
    const path = toProofSteps(raw.statProof);

    expect(verifyProof(leaf, path, toHex(raw.summary.eventStatsSubTreeRoot))).toBe(false);
  });

  it("fails on an empty path (leaf alone never equals a real root)", () => {
    const leaf = hashLeaf(raw.statToProve);
    expect(verifyProof(leaf, [], toHex(raw.eventStatRoot))).toBe(false);
  });
});

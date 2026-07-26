import { describe, expect, it } from "vitest";
import proofSample from "@/proof.sample.json";
import { normalize } from "@/lib/txline/proofs";
import { TxScoresStatValidationSchema } from "@/lib/txline/schemas";
import type { TxScoresStatValidation } from "@/lib/txline/types";

describe("proofs.normalize — real captured proof.sample.json (Brazil v Norway, 18187298)", () => {
  it("parses against the schema (real wire shape: byte-array hashes, not base64)", () => {
    const result = TxScoresStatValidationSchema.safeParse(proofSample);
    expect(result.success).toBe(true);
  });

  it("derives the correct signed FT_RESULT value from the real proof", () => {
    const proof = normalize(18187298, "FT_RESULT", 1100, proofSample as TxScoresStatValidation);

    // Real result: Brazil (home, key 1) 1 - Norway (away, key 2) 2.
    expect(proof.meta.home).toMatchObject({ statKey: 1, value: 1 });
    expect(proof.meta.away).toMatchObject({ statKey: 2, value: 2 });
    expect(proof.value).toBe(-1);
    expect(proof.meta.period).toBe(100);
    expect(proof.meta.seq).toBe(1100);
  });

  it("hex-encodes every real hash (32 bytes -> 64 hex chars) rather than leaving raw byte arrays", () => {
    const proof = normalize(18187298, "FT_RESULT", 1100, proofSample as TxScoresStatValidation);

    expect(proof.root).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.leaf).toMatch(/^[0-9a-f]{64}$/);
    for (const step of proof.path) expect(step.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flattens path as statProof + subTreeProof only, leaf-to-root order — NOT mainTreeProof", () => {
    const raw = proofSample as TxScoresStatValidation;
    const proof = normalize(18187298, "FT_RESULT", 1100, raw);

    // path/root must be a self-consistent, directly checkable pair for
    // verifyProof — mainTreeProof climbs one level past `root`
    // (summary.eventStatsSubTreeRoot) to a value TxLINE never names, so
    // it's excluded from `path` even though it's real data (still
    // available under meta.proof.mainTree). See proofs.ts's module doc
    // comment and lib/txline/verify.ts.
    expect(proof.path.length).toBe(raw.statProof.length + raw.subTreeProof.length);
    expect(proof.meta.proof.stat.length).toBe(raw.statProof.length);
    expect(proof.meta.proof.stat2.length).toBe(raw.statProof2!.length);
    expect(proof.meta.proof.subTree.length).toBe(raw.subTreeProof.length);
    expect(proof.meta.proof.mainTree.length).toBe(raw.mainTreeProof.length);
  });

  it("throws when statToProve2 is missing (FT_RESULT is inherently two-stat)", () => {
    const raw = proofSample as TxScoresStatValidation;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to exclude them from withoutSecondStat
    const { statToProve2, statProof2, ...withoutSecondStat } = raw;
    expect(() =>
      normalize(18187298, "FT_RESULT", 1100, withoutSecondStat as TxScoresStatValidation),
    ).toThrow(/statToProve2/);
  });
});

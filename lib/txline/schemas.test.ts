import { describe, expect, it } from "vitest";
import fixturesSample from "@/fixtures.sample.json";
import oddsSample from "@/odds.sample.json";
import scoresSample from "@/scores.sample.json";
import {
  TxFixturesSchema,
  TxOddsListSchema,
  TxScoresSchema,
  TxScoresStatValidationSchema,
} from "@/lib/txline/schemas";

describe("TxLINE zod schemas parse real captured payloads", () => {
  it("parses fixtures.sample.json", () => {
    const result = TxFixturesSchema.safeParse(fixturesSample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(fixturesSample.length);
      expect(result.data[0].FixtureId).toBe(fixturesSample[0].FixtureId);
    }
  });

  it("parses odds.sample.json (real empty result for a decided fixture)", () => {
    const result = TxOddsListSchema.safeParse(oddsSample);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it("parses scores.sample.json", () => {
    const result = TxScoresSchema.safeParse(scoresSample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(scoresSample.length);
      const goal = result.data.find((e) => e.Action === "goal");
      expect(goal).toBeDefined();
      expect(goal?.Data).toEqual({ GoalType: "Shot", PlayerId: 741809 });
    }
  });

  it("parses a stat-validation response, normalizing a Nil List_ProofNode to []", () => {
    // Hashes are real 32-byte arrays here, not base64 strings — the
    // OpenAPI spec's `format: binary` doesn't match the real wire
    // format, confirmed against a live response (see NOTES.md and
    // lib/txline/types.ts's TxProofNode doc comment).
    const hash = new Array(32).fill(0);
    const payload = {
      ts: 1783289390162,
      statToProve: { key: 1, value: 1, period: 100 },
      eventStatRoot: hash,
      summary: {
        fixtureId: 18187298,
        updateStats: {
          updateCount: 41,
          minTimestamp: 1782847947759,
          maxTimestamp: 1783289555398,
        },
        eventStatsSubTreeRoot: hash,
      },
      statProof: [{ hash, isRightSibling: true }],
      subTreeProof: {},
      mainTreeProof: [],
    };

    const result = TxScoresStatValidationSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subTreeProof).toEqual([]);
      expect(result.data.statProof).toHaveLength(1);
    }
  });

  it("rejects a malformed fixtures payload", () => {
    const result = TxFixturesSchema.safeParse([{ FixtureId: "not-a-number" }]);
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "@/lib/format";

describe("formatUsdc", () => {
  it("zero", () => {
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(0n, 0)).toBe("0");
    expect(formatUsdc(0n, 6)).toBe("0.000000");
  });

  it("dust — a single base unit (0.000001 USDC)", () => {
    // Truncates, not rounds, at 2dp — 1 base unit doesn't round up to a
    // cent that was never actually there.
    expect(formatUsdc(1n)).toBe("0.00");
    expect(formatUsdc(1n, 6)).toBe("0.000001");
    // Just under a full cent — still truncates to "0.00" at 2dp, not "0.01".
    expect(formatUsdc(9_999n)).toBe("0.00");
    expect(formatUsdc(9_999n, 6)).toBe("0.009999");
  });

  it("1e12 base units — large pool total, comma-grouped, no precision loss", () => {
    // 1e12 base units / 1e6 = 1,000,000.000000 USDC.
    expect(formatUsdc(1_000_000_000_000n)).toBe("1,000,000.00");
    expect(formatUsdc(1_000_000_000_000n, 0)).toBe("1,000,000");
    expect(formatUsdc(1_000_000_000_000n, 6)).toBe("1,000,000.000000");
  });

  it("an amount well beyond Number.MAX_SAFE_INTEGER stays exact", () => {
    // 9e18 base units — far past 2^53, where a Number-based formatter
    // would silently start rounding. bigint arithmetic throughout means
    // this is still exact.
    const huge = 9_000_000_000_000_000_000n;
    expect(formatUsdc(huge, 0)).toBe("9,000,000,000,000");
    expect(Number.isSafeInteger(Number(huge))).toBe(false); // confirms the test is actually exercising the risk
  });

  it("ordinary sub-dollar and multi-dollar amounts", () => {
    expect(formatUsdc(500_000n)).toBe("0.50");
    expect(formatUsdc(25_000_000n)).toBe("25.00");
    expect(formatUsdc(12_450_000_000n, 0)).toBe("12,450");
  });

  it("negative amounts", () => {
    expect(formatUsdc(-500_000n)).toBe("-0.50");
    expect(formatUsdc(-1_000_000n, 0)).toBe("-1");
  });

  it("decimals beyond the 6dp mint precision clamp to 6", () => {
    // slice(0, decimals) on a 6-digit fraction string naturally caps at 6
    // even if a caller asks for more.
    expect(formatUsdc(123_456n, 9)).toBe("0.123456");
  });
});

describe("parseUsdc", () => {
  it("round-trips through formatUsdc at 6dp for sub-1000 amounts", () => {
    // Not a round-trip for every amount: formatUsdc comma-groups the
    // whole part (see the 1e12 case above, "1,000,000.00") and parseUsdc
    // deliberately rejects commas — it parses raw typed digits from a
    // controlled <input>, never formatUsdc's own display output, so
    // that's not a bug in either direction. Restricted to amounts whose
    // whole-dollar part stays under 1000 (no comma) keeps this a
    // meaningful round-trip check without conflating the two.
    const amounts = [0n, 1n, 9_999n, 500_000n];
    for (const amount of amounts) {
      expect(parseUsdc(formatUsdc(amount, 6))).toBe(amount);
    }
  });

  it("rejects malformed input instead of throwing", () => {
    expect(parseUsdc("")).toBeNull();
    expect(parseUsdc("5.")).toBeNull();
    expect(parseUsdc("-1")).toBeNull();
    expect(parseUsdc("5.1234567")).toBeNull(); // 7dp, one too many
    expect(parseUsdc("abc")).toBeNull();
  });

  it("accepts a plain whole number and pads fractional zeros", () => {
    expect(parseUsdc("5")).toBe(5_000_000n);
    expect(parseUsdc("5.5")).toBe(5_500_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
  });
});

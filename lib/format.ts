/**
 * Display-only bigint -> string formatting. Never used for money math
 * itself (see `lib/parimutuel.ts`) — purely how an already-computed
 * bigint amount gets shown to a person.
 */

/**
 * USDC base units (bigint, 6dp) -> a locale-formatted string, e.g.
 * `formatUsdc(12_450_000_000n, 0)` -> `"12,450"`. `bigint.toLocaleString`
 * (ES2020+) handles the thousands separators directly on the whole-unit
 * bigint, so this never round-trips through `Number` and never loses
 * precision on a pool large enough that it would.
 */
export function formatUsdc(baseUnits: bigint, decimals = 2): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const wholeStr = whole.toLocaleString("en-US");
  const sign = negative ? "-" : "";

  if (decimals <= 0) return `${sign}${wholeStr}`;

  const fraction = abs % 1_000_000n;
  const fractionStr = fraction.toString().padStart(6, "0").slice(0, decimals);
  return `${sign}${wholeStr}.${fractionStr}`;
}

/**
 * The inverse of `formatUsdc` — a user-facing decimal string (a raw
 * `<input>` value, e.g. `"5.5"`) -> USDC base units. Returns `null` for
 * anything that isn't a plain non-negative decimal with at most 6
 * fractional digits (empty string, a partial/invalid edit like `"5."` or
 * `"-1"`, more than 6dp) — a controlled input's `onChange` handler should
 * treat `null` as "not a valid amount yet", not throw.
 */
export function parseUsdc(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;

  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

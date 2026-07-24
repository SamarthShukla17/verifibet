/**
 * Display-only formatting. The bigint -> string helpers here are never
 * used for money math itself (see `lib/parimutuel.ts`) — purely how an
 * already-computed bigint amount gets shown to a person; `shortenPubkey`
 * is the same idea applied to addresses instead of amounts.
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

/**
 * `formatUsdc` with an explicit leading sign — `+12.50`/`-3.00`/`0.00`
 * (zero gets no sign at all, not `+0.00`; there's nothing to signal). For
 * a realized-P&L figure specifically, where the sign itself is the point
 * (a bare `12.50` doesn't read as "profit" the way `+12.50` does) —
 * `formatUsdc` alone already handles the negative case correctly, this
 * only adds the otherwise-missing `+`.
 */
export function formatSignedUsdc(baseUnits: bigint, decimals = 2): string {
  if (baseUnits === 0n) return formatUsdc(baseUnits, decimals);
  const sign = baseUnits > 0n ? "+" : "";
  return `${sign}${formatUsdc(baseUnits, decimals)}`;
}

/**
 * `formatUsdc`'s *other* inverse — a controlled-input value, not a
 * display string. Never comma-grouped (unlike `formatUsdc`, whose commas
 * `parseUsdc` deliberately rejects) and trims trailing fractional zeros,
 * so a MAX-balance quick-chip round-trips straight back through
 * `parseUsdc` for any balance, not just the sub-1000 range `formatUsdc`
 * itself round-trips over (see format.test.ts's own round-trip test).
 */
export function usdcToInputValue(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const fraction = baseUnits % 1_000_000n;
  if (fraction === 0n) return whole.toString();

  const fractionStr = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionStr}`;
}

/** `"ULxB..F7e6"` — a base58 pubkey's first 4 and last 4 characters.
 * Shared here rather than each caller (`ActivityTab`, the leaderboard)
 * defining its own copy. */
export function shortenPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 4)}..${pubkey.slice(-4)}`;
}

/** SOL balance display — a plain `number`, not the bigint/base-units
 * convention `formatUsdc` follows: SOL gas balance is display-only
 * context for an operator (CLAUDE.md's never-floats rule is about
 * settlement amounts — `betAmount`/`payout` — not this). 4dp is enough
 * precision to see "is this wallet running low," not enough to look like
 * a precise ledger figure. */
export function formatSol(sol: number): string {
  return `${sol.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
}

export const CONFIG = {
  devnet: {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com" /* get a free Helius devnet key Day 1 — public RPC throttles the 104-market sync and keeper polling */,
    apiOrigin: "https://txline-dev.txodds.com",
    txlineProgramId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlTokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    usdcMint:
      process.env.NEXT_PUBLIC_USDC_MINT ??
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    txlineProgramId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlTokenMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
} as const;

export type Cluster = keyof typeof CONFIG;

export const CLUSTER: Cluster =
  (process.env.NEXT_PUBLIC_CLUSTER as Cluster | undefined) ?? "devnet";

export const NETWORK = CONFIG[CLUSTER];

/**
 * Circle's real devnet USDC-Dev mint — deliberately distinct from
 * `CONFIG.devnet.usdcMint` above, which resolves to this project's own
 * mock mint once `NEXT_PUBLIC_USDC_MINT` is set (see README.md's "Plan
 * notes"; it currently is set, in `.env.local`). A `Market.usdc_mint`
 * can't change after `initialize_market`, so which mint any given market
 * is actually pinned to depends entirely on when it was created — the
 * earliest markets on this devnet deployment predate the mock-mint pivot
 * and are permanently pinned to this Circle mint instead, but every
 * market created since (including all five demo-range ones — see
 * `scripts/seed-demo.ts`/`scripts/rearm-scenario.ts`) uses the mock mint.
 * There is no longer one true "the" devnet USDC mint every market shares.
 *
 * Circle's faucet only ever funds *this* mint, so it's still the right
 * answer for "can this wallet fund a brand-new bet from a faucet drip"
 * (the navbar balance chip, `WalletUx`'s no-funds nudge) — but it is
 * **not** the right mint to check "can this wallet afford a bet on
 * market X" against; that has to read the specific market's own
 * `usdcMint` field (see `lib/hooks/useBalances.ts`'s `usdcMintOverride`
 * param, and `lib/solana/market.ts`'s `MarketAccountData.usdcMint` doc
 * comment on why the on-chain field is the only source of truth). A real
 * bug from exactly this confusion — the bet slip checking this constant
 * instead of the market's own mint — was found and fixed live during
 * Session 7's demo rehearsal.
 */
export const CIRCLE_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

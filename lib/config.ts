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
 * notes"; it currently is set, in `.env.local`). Every `Market` that
 * exists on devnet today was initialized *before* that mock-mint pivot
 * and is permanently pinned to this mint instead — a `Market.usdc_mint`
 * can't change after `initialize_market` — confirmed by a real on-chain
 * read, not assumed (see NOTES.md). Circle's faucet only ever funds this
 * mint, so anywhere the app needs "how much USDC can this wallet
 * actually bet with right now" (the navbar balance chip, WalletUx's
 * no-funds nudge), this constant — not `CONFIG.devnet.usdcMint` — is the
 * one that answers honestly.
 */
export const CIRCLE_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

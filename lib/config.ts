export const CONFIG = {
  devnet: {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com" /* get a free Helius devnet key Day 1 — public RPC throttles the 104-market sync and keeper polling */,
    apiOrigin: "https://txline-dev.txodds.com",
    txlineProgramId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlTokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
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

/**
 * Cluster-aware Solana Explorer links — the one place that decides
 * whether a `?cluster=` query param is needed. Explorer defaults to
 * mainnet-beta with no param at all, so devnet is the only case that
 * needs one; this stays correct in both directions rather than being
 * devnet-only (same logic already duplicated inline in
 * components/layout/Footer.tsx, lib/solana/activity.ts, lib/receipts.ts,
 * and scripts/devnet-e2e.ts — this is the version sendTx.ts's
 * "View on Explorer" toast action calls).
 */
import { CLUSTER } from "@/lib/config";

function clusterQueryParam(): string {
  return CLUSTER === "devnet" ? "?cluster=devnet" : "";
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${clusterQueryParam()}`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}${clusterQueryParam()}`;
}

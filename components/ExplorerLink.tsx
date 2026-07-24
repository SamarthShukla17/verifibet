import { ArrowUpRight, Cpu, Hash, KeyRound, type LucideIcon } from "lucide-react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";
import { shortenPubkey } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ExplorerLinkKind = "tx" | "account" | "program";

const KIND_ICON: Record<ExplorerLinkKind, LucideIcon> = {
  tx: Hash,
  account: KeyRound,
  program: Cpu,
};

export interface ExplorerLinkProps {
  /** The real, full, untruncated signature/address — always what's
   * actually linked and copiable via `title`, regardless of `display`. */
  value: string;
  kind: ExplorerLinkKind;
  /** Overrides the truncated `value` as the shown label (e.g. Footer's
   * "VERIFIBET program" instead of a shortened address) — `value` is
   * still what the link points at and what `title` reveals on hover. */
  display?: string;
  className?: string;
}

/**
 * The one place a tx signature, account, or program address gets turned
 * into a clickable Solana Explorer link — a leading kind icon, the
 * truncated (or overridden) value, and a trailing arrow marking it opens
 * elsewhere, so a raw base58 string is never dropped into the page as
 * inert text (see CLAUDE.md's `lib/explorer.ts` for the cluster-aware
 * URL logic this wraps). `program` and `account` both resolve to
 * Explorer's `/address/` route — Solana has no separate program-lookup
 * page — the distinct `kind` only changes which icon is shown.
 */
export function ExplorerLink({ value, kind, display, className }: ExplorerLinkProps) {
  const href = kind === "tx" ? explorerTxUrl(value) : explorerAddressUrl(value);
  const Icon = KIND_ICON[kind];

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={value}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="tabular truncate">{display ?? shortenPubkey(value)}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
    </a>
  );
}

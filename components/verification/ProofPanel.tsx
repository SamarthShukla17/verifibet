"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ExplorerLink } from "@/components/ExplorerLink";
import { flagUrl } from "@/lib/flags";
import { NETWORK } from "@/lib/config";
import { verifyProof } from "@/lib/txline/verify";
import { cn } from "@/lib/utils";
import type { Receipt } from "@/lib/types";

export interface ProofPanelProps {
  receipt: Receipt;
}

type VerifyState = "idle" | "animating" | "success" | "failure";
type NodeVisualState = "neutral" | "active" | "success" | "failure";

/** Total animation budget — the requirement's own "~800ms staged
 * animation", split evenly across however many leaf->sibling->...->root
 * transitions this specific proof actually has (real proofs vary in
 * length, see lib/txline/verify.ts's own doc comment — a 1-node and a
 * 4-node proof are both real, observed shapes). Floored at 120ms/step so
 * an unusually long real proof still reads as discrete steps instead of
 * a blur. */
const TOTAL_ANIMATION_MS = 800;
const MIN_STEP_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `"a1b2c3d4…f9e8d7"` — long enough to look like a real hash, short
 * enough not to blow up the layout; the full value is always one click
 * (copy) or one hover (tooltip) away, never actually hidden. */
function truncateMiddle(value: string, front = 8, back = 6): string {
  if (value.length <= front + back + 1) return value;
  return `${value.slice(0, front)}…${value.slice(-back)}`;
}

function outcomeWinnerName(outcome: number, home: string, away: string): string {
  return outcome === 0 ? home : away;
}

function TeamMini({ name }: { name: string }) {
  const flag = flagUrl(name);
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      {flag && <img src={flag} alt="" className="h-8 w-8 shrink-0 rounded-full sm:h-10 sm:w-10" />}
      <span className="max-w-[110px] truncate text-xs font-semibold text-foreground sm:max-w-[140px] sm:text-sm">
        {name}
      </span>
    </div>
  );
}

/** Full hash on hover/focus, same custom-tooltip pattern as
 * `BetSlip.tsx`'s `InfoTooltip` — no new Radix dependency for something
 * this simple, and native `title` underneath as a no-JS/no-hover
 * fallback (screen readers, touch devices that don't hover). */
function HashTag({ value }: { value: string }) {
  return (
    <span tabIndex={0} title={value} className="group/hash relative inline-flex cursor-help outline-none">
      <span className="tabular font-mono text-[11px] leading-none">{truncateMiddle(value)}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[260px] -translate-x-1/2 break-all rounded-md border border-border bg-popover px-2.5 py-1.5 text-center font-mono text-[10px] leading-snug text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/hash:opacity-100 group-focus-visible/hash:opacity-100"
      >
        {value}
      </span>
    </span>
  );
}

const NODE_STYLES: Record<NodeVisualState, string> = {
  neutral: "border-border bg-card text-muted-foreground",
  active: "border-primary bg-primary/10 text-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]",
  success: "border-accent-gold bg-accent-gold/10 text-accent-gold shadow-[0_0_0_3px_hsl(var(--accent-gold)/0.2)]",
  failure: "border-destructive bg-destructive/10 text-destructive",
};

function NodeBox({
  kicker,
  state,
  side,
  children,
}: {
  kicker: string;
  state: NodeVisualState;
  side?: "L" | "R";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex w-[164px] shrink-0 flex-col gap-1 rounded-lg border-2 p-2.5 transition-colors duration-300",
        NODE_STYLES[state],
      )}
    >
      {side && (
        <span
          title={side === "R" ? "Right sibling" : "Left sibling"}
          className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted text-[9px] font-bold text-muted-foreground"
        >
          {side}
        </span>
      )}
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{kicker}</span>
      {children}
    </div>
  );
}

/** A slightly-bowed curve, not a ruler-straight line — "hand-drawn", per
 * the brief, and a deliberate visual signal that this isn't a diagramming
 * library's auto-routed edge. */
function Connector({ active }: { active: boolean }) {
  return (
    <svg width={32} height={24} viewBox="0 0 32 24" className="shrink-0" aria-hidden>
      <path
        d="M2,12 Q16,2 30,12"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        style={{
          stroke: active ? "hsl(var(--primary))" : "hsl(var(--border))",
          transition: "stroke 300ms",
        }}
      />
    </svg>
  );
}

function FactRow({
  label,
  value,
  display,
  linkKind,
}: {
  label: string;
  value: string;
  /** Shown instead of `value` when set (and no `linkKind`) — `value` is
   * still what gets copied, always the real, full, uncosmetic string. */
  display?: string;
  /** When set, the value renders as an `ExplorerLink` (icon + truncated
   * value + external affordance) instead of inert text — `resolveTxSig`
   * and `TxLINE program` are real on-chain things worth one click away;
   * `proofRoot` (a hash, not an address Explorer can look up) has none. */
  linkKind?: "tx" | "program";
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        {linkKind ? (
          <ExplorerLink
            value={value}
            kind={linkKind}
            display={display}
            className="text-foreground hover:no-underline hover:text-primary"
          />
        ) : (
          <span className="tabular truncate font-mono text-xs text-foreground">{display ?? value}</span>
        )}
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={`Copy ${label}`}
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

/**
 * The proof, made legible: a real on-chain-resolved market's settlement
 * — final score, which side the payout follows, and the actual Merkle
 * chain (leaf -> sibling hashes -> the root that's really stored
 * on-chain) walked as a small interactive diagram instead of a wall of
 * hex. "Verify in your browser" re-runs `verifyProof` (`lib/txline/
 * verify.ts`) *in this tab*, against the exact `leaf`/`path`/`root` this
 * panel already fetched — the ~800ms staged reveal is a pacing device
 * over an already-real, already-computed result (computed synchronously
 * before the animation even starts — see `handleVerify`), not a fake
 * "checking..." spinner over nothing.
 */
export function ProofPanel({ receipt }: ProofPanelProps) {
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [litCount, setLitCount] = useState(0);
  const [showPlainEnglish, setShowPlainEnglish] = useState(false);

  const totalSegments = receipt.proofPath.length + 1; // leaf->...->root transitions

  async function handleVerify() {
    if (verifyState === "animating") return;

    // Real, synchronous, and first — the animation below narrates a
    // result that already exists, it doesn't stand in for one.
    const result = verifyProof(receipt.proofLeaf, receipt.proofPath, receipt.proofRoot);

    setVerifyState("animating");
    setLitCount(0);
    const stepMs = Math.max(MIN_STEP_MS, Math.round(TOTAL_ANIMATION_MS / totalSegments));
    for (let i = 1; i <= totalSegments; i++) {
      await sleep(stepMs);
      setLitCount(i);
    }
    setVerifyState(result ? "success" : "failure");
  }

  function nodeState(index: number, isRoot: boolean): NodeVisualState {
    if (verifyState === "idle") return "neutral";
    if (index > litCount) return "neutral";
    if (isRoot && litCount === totalSegments && verifyState !== "animating") {
      return verifyState === "success" ? "success" : "failure";
    }
    return "active";
  }

  const winner = outcomeWinnerName(receipt.outcome, receipt.teams.home, receipt.teams.away);
  const winnerFlag = receipt.outcome !== 1 ? flagUrl(winner) : null;

  const verifyButtonLabel =
    verifyState === "animating" ? "Verifying…" : verifyState === "idle" ? "Verify in your browser" : "Verify again";

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        Settled by TxODDS TxLINE — outcome verified on-chain
      </div>

      <div className="flex items-center justify-center gap-4 py-1 sm:gap-6">
        <TeamMini name={receipt.teams.home} />
        <span className="tabular font-display text-2xl font-bold text-foreground sm:text-3xl">
          {receipt.finalScore.home}
          <span className="mx-1.5 text-muted-foreground">–</span>
          {receipt.finalScore.away}
        </span>
        <TeamMini name={receipt.teams.away} />
      </div>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {winnerFlag && <img src={winnerFlag} alt="" className="h-3.5 w-3.5 rounded-full" />}
          {receipt.outcome === 1 ? "Match drawn" : `${winner} won`}
        </span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          The proof, made human
        </p>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          <NodeBox kicker="Leaf" state={nodeState(0, false)}>
            <span className="text-[11px] leading-snug">
              Match {receipt.fixtureId} · FT: {receipt.teams.home} {receipt.finalScore.home}–
              {receipt.finalScore.away} {receipt.teams.away}
            </span>
          </NodeBox>

          {receipt.proofPath.map((step, i) => (
            <div key={i} className="flex items-center gap-1">
              <Connector active={i < litCount} />
              <NodeBox kicker={`Sibling ${i + 1}`} state={nodeState(i + 1, false)} side={step.isRightSibling ? "R" : "L"}>
                <HashTag value={step.hash} />
              </NodeBox>
            </div>
          ))}

          <div className="flex items-center gap-1">
            <Connector active={receipt.proofPath.length < litCount} />
            <NodeBox kicker="Root (on-chain)" state={nodeState(totalSegments, true)}>
              <HashTag value={receipt.proofRoot} />
            </NodeBox>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 pt-1">
        <Button onClick={() => void handleVerify()} disabled={verifyState === "animating"} className="glow-emerald">
          {verifyButtonLabel}
        </Button>
        {verifyState === "success" && (
          <p className="flex items-center gap-1.5 text-center text-sm font-semibold text-accent-gold">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Root reconstructed locally — this result cannot be forged.
          </p>
        )}
        {verifyState === "failure" && (
          <p className="flex items-center gap-1.5 text-center text-sm font-semibold text-destructive">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden />
            Root did not match locally — do not trust this result.
          </p>
        )}
      </div>

      <div>
        <FactRow
          label="Resolve tx"
          value={receipt.resolveTxSig}
          display={truncateMiddle(receipt.resolveTxSig, 10, 8)}
          linkKind="tx"
        />
        <FactRow label="Proof root" value={receipt.proofRoot} display={truncateMiddle(receipt.proofRoot, 10, 8)} />
        <FactRow
          label="TxLINE program"
          value={NETWORK.txlineProgramId}
          display={truncateMiddle(NETWORK.txlineProgramId, 10, 8)}
          linkKind="program"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            View on Explorer
          </a>
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm">
              Raw proof
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Raw proof</DialogTitle>
              <DialogDescription>
                Exactly what this panel fetched and verified — copy this and check it independently, with
                nothing from this app trusted along the way.
              </DialogDescription>
            </DialogHeader>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-[11px] leading-relaxed text-foreground">
              {JSON.stringify(receipt, null, 2)}
            </pre>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowPlainEnglish((v) => !v)}
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {showPlainEnglish ? "Hide the plain-English version" : "What does this actually mean?"}
        </button>
        {showPlainEnglish && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            TxODDS publishes match-data fingerprints on Solana. Our contract only pays out when the
            result matches those fingerprints — VERIFIBET never touches the outcome.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * `sendAndConfirm` is the ONE way every mutation in this app ships a
 * transaction — every place that calls `place_bet`, `claim_winnings`,
 * `claim_refund`, etc. from the client goes through this, not a
 * hand-rolled `sendTransaction`/`confirmTransaction` pair, so the toast
 * lifecycle and error copy stay identical everywhere a wallet signs
 * something.
 *
 * Lifecycle: one `toast.loading` at the start, replaced in place (same
 * `id`) by either `toast.success` with a "View on Explorer" action, or
 * `toast.error` with human copy from `mapSendError` — except a user
 * closing/rejecting the wallet popup, which just dismisses the loading
 * toast rather than showing an error for something the user did on
 * purpose.
 */
import { AnchorError } from "@coral-xyz/anchor";
import type { Connection, Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { explorerTxUrl } from "@/lib/explorer";

/**
 * `VerifibetError` names + msgs, copied from
 * `lib/solana/idl/verifibet.json`'s `errors` array (`anchor/programs/verifibet/src/errors.rs`
 * is the source of truth on the Rust side) — kept as a plain string map
 * rather than derived from the IDL's JSON shape at runtime, since the
 * set of fifteen codes is small and stable enough that a typo here would
 * rather be a compile-time-visible object literal than something that
 * silently falls through to the generic fallback copy.
 */
const VERIFIBET_ERROR_COPY: Record<string, string> = {
  MarketNotOpen: "This market isn't open for betting",
  KickoffPassed: "Betting closed — match has kicked off",
  KickoffNotPassed: "Match hasn't kicked off yet",
  InvalidOutcome: "Invalid outcome selected",
  MarketNotResolved: "Market hasn't resolved yet",
  MarketNotVoided: "Market wasn't voided",
  NotWinningBet: "This bet didn't win",
  AlreadyClaimed: "You've already claimed this bet",
  Unauthorized: "You're not authorized for this action",
  ZeroAmount: "Enter an amount greater than zero",
  MathOverflow: "That amount is too large",
  TooEarlyToVoid: "Too early to void this market",
  MintMismatch: "Wrong token account for this market",
  NameTooLong: "Team name is too long",
  InvalidStatProof: "Couldn't verify the match result",
};

const GENERIC_ERROR_COPY = "Something went wrong sending your transaction";

export interface MappedSendError {
  message: string;
  /** `true` => don't show an error toast at all — the user closed or
   * rejected the wallet popup themselves, which isn't a failure worth
   * interrupting them about. */
  silent: boolean;
}

function errorMessage(error: unknown): string {
  return typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";
}

/** Covers both Phantom/Solflare's own "User rejected the request."-style
 * messages and the wallet-adapter's `WalletSignTransactionError`/
 * `WalletSendTransactionError` wrapper names — message content, not just
 * the wrapper class name, since the underlying wording is the part that's
 * actually consistent across wallets. */
function isUserRejection(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const msg = errorMessage(error).toLowerCase();
  if (name === "WalletSignTransactionError" || name === "WalletSendTransactionError") {
    if (msg.length === 0) return true; // rejection with no further detail
  }
  return msg.includes("user rejected") || msg.includes("rejected the request") || msg.includes("user declined");
}

function isBlockhashExpired(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return (
    msg.includes("block height exceeded") ||
    msg.includes("blockhash not found") ||
    msg.includes("blockhash expired")
  );
}

function isInsufficientFunds(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("insufficient");
}

function parseAnchorError(error: unknown): AnchorError | null {
  if (error instanceof AnchorError) return error;
  const logs = (error as { logs?: string[] })?.logs;
  if (!logs) return null;
  try {
    return AnchorError.parse(logs);
  } catch {
    return null;
  }
}

/** Exported standalone (not just used internally by `sendAndConfirm`) so
 * it can be unit-tested without needing a live wallet/connection. */
export function mapSendError(error: unknown): MappedSendError {
  if (isUserRejection(error)) {
    return { message: "", silent: true };
  }

  const anchorError = parseAnchorError(error);
  if (anchorError) {
    const copy = VERIFIBET_ERROR_COPY[anchorError.error.errorCode.code];
    if (copy) return { message: copy, silent: false };
  }

  if (isBlockhashExpired(error)) {
    return { message: "Network was slow — try again", silent: false };
  }

  if (isInsufficientFunds(error)) {
    return { message: "Not enough USDC", silent: false };
  }

  return { message: GENERIC_ERROR_COPY, silent: false };
}

export interface SendAndConfirmOptions {
  /** Human label for the toast copy, e.g. "Placing bet", "Claiming winnings". */
  label: string;
}

/**
 * Stamps a fresh blockhash + fee payer onto `tx`, sends it through the
 * connected wallet adapter, confirms at `'confirmed'`, and drives the
 * toast lifecycle end to end. Returns the signature on success; rethrows
 * the original error on failure (after showing/dismissing the toast) so
 * callers can still run their own cleanup (e.g. resetting a form).
 */
export async function sendAndConfirm(
  connection: Connection,
  wallet: WalletContextState,
  tx: Transaction,
  { label }: SendAndConfirmOptions,
): Promise<string> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    throw new Error("Wallet not connected");
  }

  const toastId = toast.loading(`${label}…`);

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    const signature = await wallet.sendTransaction(tx, connection);

    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

    toast.success(`${label} confirmed`, {
      id: toastId,
      action: {
        label: "View on Explorer",
        onClick: () => window.open(explorerTxUrl(signature), "_blank", "noreferrer"),
      },
    });

    return signature;
  } catch (error) {
    const { message, silent } = mapSendError(error);
    if (silent) {
      toast.dismiss(toastId);
    } else {
      toast.error(message, { id: toastId });
    }
    throw error;
  }
}

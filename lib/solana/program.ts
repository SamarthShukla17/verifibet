/**
 * Shared Anchor `Program` construction — originally inlined in
 * app/api/receipts/[fixtureId]/route.ts (see that file's own history for
 * the full reasoning); extracted here once a fourth read-only call site
 * (app/api/markets/[fixtureId]/route.ts's pool/activity reads) needed the
 * exact same thing, per that file's own "worth extracting... if a fourth
 * one appears" note. `getProgram` (client-side, real connection + real
 * pubkey) came later for BetSlip's `place_bet`-instruction building — see
 * its own doc comment below for why it's still safe to hand-roll the same
 * no-op wallet rather than a real signer.
 *
 * The wallet is hand-rolled (`publicKey` + no-op signers) rather than
 * `anchor.Wallet`/`NodeWallet` — that class's real implementation
 * transitively requires `rpc-websockets` -> `uuid`, which fails to bundle
 * under Next's webpack specifically ("`Wallet` is not exported from
 * `@coral-xyz/anchor`" at runtime, despite type-checking fine). Passing an
 * untyped object literal lets it structurally check against whatever
 * `AnchorProvider`'s constructor actually wants instead.
 *
 * `getReadOnlyProgram` is devnet-only, matching every other read-only call
 * site in this repo — `CONFIG.devnet.rpcUrl` directly, not `NETWORK`,
 * since this hackathon's target is devnet only (see CLAUDE.md).
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { CONFIG } from "@/lib/config";
import verifibetIdl from "@/lib/solana/idl/verifibet.json";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
);

/**
 * Matches Anchor's own camelCasing of each `::`-separated segment of
 * "verifibet::state::Market" independently — confirmed against a real
 * devnet decode (see lib/receipts.ts's longer doc comment): only the last
 * segment's leading letter changes, so `program.coder.accounts.decode`
 * needs this exact string, not the raw IDL name.
 */
export const MARKET_ACCOUNT_IDL_NAME = "verifibet::state::market";
export const BET_ACCOUNT_IDL_NAME = "verifibet::state::bet";

/** Never actually signs anything (`signTransaction` is the identity
 * function) — safe even with a real, connected wallet's `publicKey`
 * because building an instruction via `program.methods.x(...).instruction()`
 * does no signing and no RPC calls of its own. Sending/signing for real
 * always goes through `lib/solana/sendTx.ts#sendAndConfirm` and the actual
 * wallet adapter instead, never through this `Program`/`AnchorProvider`. */
function noopWallet(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
  };
}

export function getReadOnlyProgram(): anchor.Program {
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, noopWallet(Keypair.generate().publicKey), {
    commitment: "confirmed",
  });
  return new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);
}

/**
 * Client-side counterpart to `getReadOnlyProgram` — takes the real,
 * already-connected `Connection` (from `useConnection()`) and the real
 * connected wallet's `publicKey`, purely so `.instruction()` calls can
 * build accurate `place_bet`/`claim_winnings`/etc. instructions without a
 * second RPC connection. Still never signs or sends anything itself (see
 * `noopWallet`'s doc comment) — that's `sendAndConfirm`'s job once the
 * caller has a built `Transaction` in hand.
 */
export function getProgram(connection: Connection, publicKey: PublicKey): anchor.Program {
  const provider = new anchor.AnchorProvider(connection, noopWallet(publicKey), {
    commitment: "confirmed",
  });
  return new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);
}

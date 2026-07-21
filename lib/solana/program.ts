/**
 * Shared read-only Anchor `Program` construction — originally inlined in
 * app/api/receipts/[fixtureId]/route.ts (see that file's own history for
 * the full reasoning); extracted here once a fourth read-only call site
 * (app/api/markets/[fixtureId]/route.ts's pool/activity reads) needed the
 * exact same thing, per that file's own "worth extracting... if a fourth
 * one appears" note.
 *
 * The wallet is hand-rolled (`publicKey` + no-op signers) rather than
 * `anchor.Wallet`/`NodeWallet` — that class's real implementation
 * transitively requires `rpc-websockets` -> `uuid`, which fails to bundle
 * under Next's webpack specifically ("`Wallet` is not exported from
 * `@coral-xyz/anchor`" at runtime, despite type-checking fine). Passing an
 * untyped object literal lets it structurally check against whatever
 * `AnchorProvider`'s constructor actually wants instead.
 *
 * Devnet-only, matching every other read-only call site in this repo —
 * `CONFIG.devnet.rpcUrl` directly, not `NETWORK`, since this hackathon's
 * target is devnet only (see CLAUDE.md).
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

/**
 * Matches Anchor's own camelCasing of each `::`-separated segment of
 * "verifibet::state::Market" independently — confirmed against a real
 * devnet decode (see lib/receipts.ts's longer doc comment): only the last
 * segment's leading letter changes, so `program.coder.accounts.decode`
 * needs this exact string, not the raw IDL name.
 */
export const MARKET_ACCOUNT_IDL_NAME = "verifibet::state::market";
export const BET_ACCOUNT_IDL_NAME = "verifibet::state::bet";

function readOnlyWallet(keypair: Keypair) {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
  };
}

export function getReadOnlyProgram(): anchor.Program {
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, readOnlyWallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  const programId = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
  );
  return new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: programId.toBase58() }, provider);
}

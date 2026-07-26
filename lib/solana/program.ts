/**
 * Anchor `Program` construction (both read-only and client-signing) plus
 * `placeBet` — the one function that builds a real `place_bet`
 * `Transaction`. Building is all this module does; sending is always
 * `lib/solana/sendTx.ts#sendAndConfirm`'s job, never this one's.
 *
 * The read-only wallet is hand-rolled (`publicKey` + no-op signers)
 * rather than `anchor.Wallet`/`NodeWallet` — that class's real
 * implementation transitively requires `rpc-websockets` -> `uuid`, which
 * fails to bundle under Next's webpack specifically ("`Wallet` is not
 * exported from `@coral-xyz/anchor`" at runtime, despite type-checking
 * fine). Passing an untyped object literal lets it structurally check
 * against whatever `AnchorProvider`'s constructor actually wants instead.
 *
 * `getReadOnlyProgram` is devnet-only, matching every other read-only call
 * site in this repo — `CONFIG.devnet.rpcUrl` directly, not `NETWORK`,
 * since this hackathon's target is devnet only (see CLAUDE.md).
 *
 * `@solana/spl-token` is imported dynamically inside each transaction
 * builder below, not statically at module scope — that package
 * (transitively `bn.js`/`buffer`/`@solana/buffer-layout`/`borsh`) is
 * ~65KB gzipped, and this module is reachable from every page that
 * renders `BetSlip` (including `/matches`'s list view). A static import
 * would ship that weight in every route's first-load JS even though it's
 * only ever needed once a transaction is actually being built.
 *
 * `@coral-xyz/anchor` itself is dynamically imported for the same reason
 * (in `getReadOnlyProgram`/`getProgram` specifically) — it's a large,
 * not-very-tree-shakeable SDK, and every real caller here is already
 * inside an async function (a `useEffect` fetch, a submit handler).
 * `anchor.Idl`/`anchor.Program`/`anchor.Wallet` type references below
 * stay as regular `import type` — types are erased at compile time and
 * cost nothing in the shipped bundle.
 */
import type * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { CONFIG } from "@/lib/config";
import { deriveBet, deriveMarket, deriveVault, PROGRAM_ID } from "@/lib/solana/pda";
import type { Outcome } from "@/lib/types";
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

/** Never actually signs anything (`signTransaction` is the identity
 * function) — used only for read-only `Program`s that just decode
 * accounts / build instructions, never send. */
function noopWallet(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
  };
}

export async function getReadOnlyProgram(): Promise<anchor.Program> {
  const { AnchorProvider, Program } = await import("@coral-xyz/anchor");
  const connection = new Connection(CONFIG.devnet.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, noopWallet(Keypair.generate().publicKey), {
    commitment: "confirmed",
  });
  return new Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);
}

/**
 * The real, client-side `Program` — a genuinely connected wallet (from
 * `useWallet()`), not a placeholder. Still never signs or sends through
 * this `Program`/`AnchorProvider` itself: every method below only ever
 * calls `.transaction()` (pure local encoding), and the actual signing +
 * sending happens through `sendAndConfirm` and the wallet adapter's own
 * `sendTransaction` — so `wallet.signTransaction` being merely *possibly*
 * undefined on `WalletContextState`'s type (some adapters don't implement
 * it) never actually matters here.
 */
export async function getProgram(connection: Connection, wallet: WalletContextState): Promise<anchor.Program> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const { AnchorProvider, Program } = await import("@coral-xyz/anchor");
  const provider = new AnchorProvider(connection, wallet as unknown as anchor.Wallet, {
    commitment: "confirmed",
  });
  return new Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);
}

export interface PlaceBetParams {
  fixtureId: bigint;
  outcome: Outcome;
  /** USDC base units, 6dp. */
  amountBaseUnits: bigint;
}

/**
 * Builds a real `place_bet` `Transaction` for the wallet `program` was
 * constructed with (`getProgram`'s caller). Reads the market's own
 * `usdc_mint` field on-chain rather than trusting a client-cached value —
 * that field is fixed forever at `initialize_market` (see state.rs), so
 * this is the one authoritative source, not `CONFIG.devnet.usdcMint` or
 * anything passed in by the caller.
 *
 * Prepends an idempotent ATA-create instruction for the user's USDC
 * account when it doesn't exist yet — `place_bet` itself has no
 * `init_if_needed` on `user_usdc` (only `bet` does), so a wallet that's
 * never touched USDC before would otherwise fail with a plain "account
 * does not exist" instead of a single extra, safe-to-always-attempt
 * instruction fixing it in the same transaction.
 *
 * Every account is computed explicitly via `lib/solana/pda.ts`, never via
 * Anchor's own PDA auto-resolution — CLAUDE.md documents three separate
 * real Anchor 0.30.1 codegen bugs already hit in this exact program, so
 * nothing here trusts Anchor to get an address right that this function
 * can just as easily derive itself.
 */
export async function placeBet(program: anchor.Program, params: PlaceBetParams): Promise<Transaction> {
  const { BN } = await import("@coral-xyz/anchor");
  const { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } =
    await import("@solana/spl-token");

  const user = program.provider.publicKey;
  if (!user) throw new Error("Wallet not connected");

  const [market] = deriveMarket(params.fixtureId);

  const marketAccountClient = (program.account as Record<string, { fetch(addr: PublicKey): Promise<{ usdcMint: PublicKey }> }>)[
    MARKET_ACCOUNT_IDL_NAME
  ];
  const marketAccount = await marketAccountClient.fetch(market);
  const usdcMint = marketAccount.usdcMint;

  const [bet] = deriveBet(market, user, params.outcome);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const vault = await deriveVault(usdcMint, market);

  const tx = await program.methods
    .placeBet(params.outcome, new BN(params.amountBaseUnits.toString()))
    .accounts({
      user,
      market,
      bet,
      userUsdc,
      usdcMint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .transaction();

  const userUsdcInfo = await program.provider.connection.getAccountInfo(userUsdc);
  if (!userUsdcInfo) {
    tx.instructions.unshift(
      createAssociatedTokenAccountIdempotentInstruction(user, userUsdc, user, usdcMint),
    );
  }

  return tx;
}

export interface ClaimRefundParams {
  fixtureId: bigint;
  /** The bet's own stored outcome — `claim_refund` takes no `outcome`
   * argument (see `void_and_refund.rs`'s `ClaimRefund` accounts doc
   * comment: `bet`'s seeds re-derive from its own stored `outcome`),
   * but this client still needs it to derive the same `bet` PDA
   * `deriveBet` expects. */
  outcome: Outcome;
}

/**
 * Builds a real `claim_refund` `Transaction` — exact stake back,
 * unconditionally, once `keeper/void.ts` has voided the market (see that
 * instruction's own doc comment: no proportional payout to compute,
 * unlike `claim_winnings`). No idempotent ATA-create prepended here
 * unlike `placeBet`: `user_usdc` is guaranteed to already exist by the
 * time a `Bet` account does — `placeBet` above is the only way a `Bet`
 * gets created, and it already ensures `user_usdc` exists in that same
 * transaction.
 *
 * Every account computed explicitly via `lib/solana/pda.ts`, same
 * "never trust Anchor's own PDA auto-resolution" reasoning as `placeBet`.
 */
export async function claimRefund(program: anchor.Program, params: ClaimRefundParams): Promise<Transaction> {
  const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = await import("@solana/spl-token");

  const user = program.provider.publicKey;
  if (!user) throw new Error("Wallet not connected");

  const [market] = deriveMarket(params.fixtureId);

  const marketAccountClient = (program.account as Record<string, { fetch(addr: PublicKey): Promise<{ usdcMint: PublicKey }> }>)[
    MARKET_ACCOUNT_IDL_NAME
  ];
  const marketAccount = await marketAccountClient.fetch(market);
  const usdcMint = marketAccount.usdcMint;

  const [bet] = deriveBet(market, user, params.outcome);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const vault = await deriveVault(usdcMint, market);

  return program.methods
    .claimRefund()
    .accounts({
      user,
      market,
      bet,
      vault,
      userUsdc,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
}

export interface ClaimWinningsParams {
  fixtureId: bigint;
  /** Same reasoning as `ClaimRefundParams.outcome` — `claim_winnings`
   * itself takes no `outcome` argument (see `claim_winnings.rs`'s `Bet`
   * seeds, which re-derive from the account's own stored `outcome`), but
   * this client still needs it to derive the same `bet` PDA `deriveBet`
   * expects. */
  outcome: Outcome;
}

/**
 * Builds a real `claim_winnings` `Transaction` — the parimutuel payout
 * for a winning `Bet` on a `Resolved` market (`stake * total_pool /
 * winning_pool`, floored — computed entirely on-chain, see
 * `claim_winnings.rs`). Not currently called from any UI component
 * (`components/bet/PositionRow.tsx`'s CLAIM button is still a
 * placeholder toast, "Claiming lands in Phase 6") — this exists for
 * `scripts/seed-demo.ts`/`scripts/reset-demo.ts`, which call it directly
 * against the presenter wallet to enforce "exactly one outstanding
 * claimable win" rather than leaving every incidentally-resolved winning
 * bet sitting unclaimed. Same account-derivation and no-ATA-create
 * reasoning as `claimRefund` above.
 */
export async function claimWinnings(program: anchor.Program, params: ClaimWinningsParams): Promise<Transaction> {
  const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = await import("@solana/spl-token");

  const user = program.provider.publicKey;
  if (!user) throw new Error("Wallet not connected");

  const [market] = deriveMarket(params.fixtureId);

  const marketAccountClient = (program.account as Record<string, { fetch(addr: PublicKey): Promise<{ usdcMint: PublicKey }> }>)[
    MARKET_ACCOUNT_IDL_NAME
  ];
  const marketAccount = await marketAccountClient.fetch(market);
  const usdcMint = marketAccount.usdcMint;

  const [bet] = deriveBet(market, user, params.outcome);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const vault = await deriveVault(usdcMint, market);

  return program.methods
    .claimWinnings()
    .accounts({
      user,
      market,
      bet,
      vault,
      userUsdc,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
}

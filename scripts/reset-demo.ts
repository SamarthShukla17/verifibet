/**
 * Re-arms the presenter wallet's claimable win between video takes.
 * `scripts/seed-demo.ts` leaves exactly one unclaimed winning `Bet` on
 * the presenter (dev) wallet; if a take actually claims it (once
 * `claim_winnings` is wired into the UI — see
 * `lib/solana/program.ts#claimWinnings`'s own doc comment, it isn't yet)
 * there's nothing left to demo on the next take. Running this checks
 * whether that bet is still unclaimed and, if not, fabricates a fresh one
 * — same logic `seed-demo.ts` itself uses on a completely fresh
 * environment, see `scripts/demoRig.ts#ensureExactlyOneClaimableWin`'s
 * own doc comment for the full reasoning (a real, historical fixture,
 * bet on the side that already won, resolved through the genuine keeper
 * backfill path — never a fabricated outcome).
 *
 * Safe to run any time, including right after `seed-demo.ts` itself —
 * finds the still-unclaimed win and no-ops rather than needlessly
 * spinning up a second one.
 *
 * Usage: pnpm tsx scripts/reset-demo.ts  (or `pnpm reset:demo`)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import pino from "pino";
import { Connection, Keypair } from "@solana/web3.js";

import { ensureExactlyOneClaimableWin } from "@/scripts/demoRig";
import { loadDemoState, DEMO_STATE_PATH } from "@/scripts/demoState";
import { deriveMarket, deriveBet } from "@/lib/solana/pda";
import { getReadOnlyProgram, BET_ACCOUNT_IDL_NAME, MARKET_ACCOUNT_IDL_NAME } from "@/lib/solana/program";
import { explorerAddressUrl } from "@/lib/explorer";

function loadDevKeypair(): Keypair {
  const raw = JSON.parse(readFileSync(join(homedir(), ".config", "solana", "id.json"), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function resolveDevnetRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
}

async function isStillArmed(devWalletPubkey: Keypair["publicKey"], fixtureId: number, outcome: number): Promise<boolean> {
  const readOnly = await getReadOnlyProgram();
  const marketClient = (readOnly.account as any)[MARKET_ACCOUNT_IDL_NAME];
  const betClient = (readOnly.account as any)[BET_ACCOUNT_IDL_NAME];

  const [market] = deriveMarket(BigInt(fixtureId));
  const marketAccount = await marketClient.fetchNullable(market);
  if (!marketAccount || Object.keys(marketAccount.status)[0] !== "resolved" || marketAccount.outcome !== outcome) {
    return false;
  }
  const [bet] = deriveBet(market, devWalletPubkey, outcome as 0 | 1 | 2);
  const betAccount = await betClient.fetchNullable(bet);
  return Boolean(betAccount && betAccount.amount.toNumber() > 0 && !betAccount.claimed);
}

async function main() {
  const connection = new Connection(resolveDevnetRpcUrl(), "confirmed");
  const devWallet = loadDevKeypair();
  const logger = pino({ level: "info" });

  console.log(`presenter wallet: ${devWallet.publicKey.toBase58()}`);

  const priorState = loadDemoState();
  if (priorState) {
    const armed = await isStillArmed(devWallet.publicKey, priorState.designatedWin.fixtureId, priorState.designatedWin.outcome);
    if (armed) {
      const [market] = deriveMarket(BigInt(priorState.designatedWin.fixtureId));
      console.log(
        `already armed — fixture ${priorState.designatedWin.fixtureId}, outcome ${priorState.designatedWin.outcome}, ` +
          `market ${market.toBase58()} (${explorerAddressUrl(market.toBase58())}). Nothing to do.`,
      );
      return;
    }
    console.log(`designated win (fixture ${priorState.designatedWin.fixtureId}) is claimed or missing — re-arming`);
  } else {
    console.log(`no prior demo state found (${DEMO_STATE_PATH}) — run scripts/seed-demo.ts first for the full setup, or continuing to arm a win on its own`);
  }

  const state = await ensureExactlyOneClaimableWin(connection, devWallet, logger);

  console.log(`\n✅ Re-armed.`);
  console.log(`   receipt: /receipts/${state.designatedWin.fixtureId}`);
  console.log(`   portfolio: /portfolio  (connect ${devWallet.publicKey.toBase58()})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Gives one demo scenario a genuinely fresh, pre-kickoff, bettable
 * on-chain market — the "reset command" DEMO_RUNBOOK.md points to
 * between rehearsal takes.
 *
 * ## Why this has to exist at all
 *
 * `initialize_market` is a true one-shot per `fixture_id` (an `init`
 * constraint on a PDA — Solana has no "re-initialize" or "update
 * kickoff" instruction for this program). The very first time a demo
 * scenario's market was seeded (`scripts/seed-demo.ts`), its
 * `kickoff_ts` was frozen forever at whatever the seed script's buffer
 * computed — once real time passes that moment, `place_bet`'s own
 * on-chain `KickoffPassed` guard permanently blocks any further bet on
 * that exact account, with no way back. Confirmed live this session: all
 * five demo-range markets from the earlier seed run are stuck exactly
 * like this, hours past their original kickoff.
 *
 * The fix is a fresh `fixture_id`, not a fresh `Market` account for the
 * same one. This script rewrites the scenario's own `.rest.json`/`.ndjson`
 * (`meta.demoFixtureId`, every embedded `FixtureId`) to a new demo-range
 * id — `realFixtureId + DEMO_FIXTURE_OFFSET + <fresh salt>` — derived
 * from the current minute so it's always different from every prior
 * generation, never colliding with a real fixture id (comfortably above
 * the highest real one) or another scenario's (each scenario's own
 * `realFixtureId` base keeps them apart). The *old* id is simply
 * abandoned — same "left inert, not cleaned up" treatment CLAUDE.md
 * already documents for the `mock-txline` incident, not a new pattern.
 *
 * **After running this, restart the Next.js dev server** —
 * `lib/txline/demoScenarios.ts#loadDemoScenarios()` caches the parsed
 * scenario files at module scope for the life of the process, so a
 * running server won't see the rewrite otherwise.
 *
 * Usage: pnpm tsx scripts/rearm-scenario.ts <scenario> [kickoffBufferSeconds]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { deriveMarket, PROGRAM_ID } from "@/lib/solana/pda";
import { truncateToBytes } from "@/scripts/sync-markets";
import { DEMO_FIXTURE_OFFSET } from "@/lib/txline/demoScenarios";

const DEFAULT_KICKOFF_BUFFER_SECONDS = 90;

function loadDevKeypair(): Keypair {
  const raw = JSON.parse(readFileSync(join(homedir(), ".config", "solana", "id.json"), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function resolveDevnetRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
}

function resolveUsdcMint(): PublicKey {
  return new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
}

/** Fresh every run (minute granularity), always positive, small enough
 * to stay well clear of any real fixture id / other scenario's own base
 * — see module doc comment. */
function freshSalt(): number {
  return Math.floor(Date.now() / 60_000) % 90_000;
}

function rewriteFixtureId(value: unknown, newId: number): void {
  if (value && typeof value === "object" && "FixtureId" in (value as Record<string, unknown>)) {
    (value as Record<string, unknown>).FixtureId = newId;
  }
}

async function main() {
  const scenarioName = process.argv[2];
  const kickoffBufferSeconds = Number(process.argv[3] ?? DEFAULT_KICKOFF_BUFFER_SECONDS);
  if (!scenarioName) {
    throw new Error("usage: pnpm tsx scripts/rearm-scenario.ts <scenario> [kickoffBufferSeconds]");
  }

  const scenariosDir = join(process.cwd(), "demo-data", "scenarios");
  const restPath = join(scenariosDir, `${scenarioName}.rest.json`);
  const ndjsonPath = join(scenariosDir, `${scenarioName}.ndjson`);
  if (!existsSync(restPath) || !existsSync(ndjsonPath)) {
    throw new Error(`no scenario named "${scenarioName}" under ${scenariosDir}`);
  }

  const rest = JSON.parse(readFileSync(restPath, "utf-8"));
  const realFixtureId: number = rest.meta.realFixtureId;
  const oldDemoFixtureId: number = rest.meta.demoFixtureId;
  const newDemoFixtureId = realFixtureId + DEMO_FIXTURE_OFFSET + freshSalt();

  console.log(`rearming "${scenarioName}": ${oldDemoFixtureId} (abandoned, permanently past kickoff) -> ${newDemoFixtureId}`);

  rest.meta.demoFixtureId = newDemoFixtureId;
  rewriteFixtureId(rest.fixture, newDemoFixtureId);
  for (const s of rest.scores ?? []) rewriteFixtureId(s, newDemoFixtureId);
  for (const o of rest.odds ?? []) rewriteFixtureId(o, newDemoFixtureId);
  writeFileSync(restPath, JSON.stringify(rest, null, 2) + "\n");

  const lines = readFileSync(ndjsonPath, "utf-8").split("\n").filter((l) => l.trim().length > 0);
  const rewrittenLines = lines.map((line) => {
    const parsed = JSON.parse(line);
    rewriteFixtureId(parsed.data, newDemoFixtureId);
    return JSON.stringify(parsed);
  });
  writeFileSync(ndjsonPath, rewrittenLines.join("\n") + "\n");
  console.log(`rewrote ${restPath} and ${ndjsonPath} (${rewrittenLines.length} lines)`);

  const connection = new Connection(resolveDevnetRpcUrl(), "confirmed");
  const devWallet = loadDevKeypair();
  const usdcMint = resolveUsdcMint();
  const kickoffTs = Math.floor(Date.now() / 1000) + kickoffBufferSeconds;

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(devWallet), { commitment: "confirmed" });
  const verifibetIdl = (await import("@/lib/solana/idl/verifibet.json")).default;
  const program = new anchor.Program({ ...(verifibetIdl as anchor.Idl), address: PROGRAM_ID.toBase58() }, provider);

  const [market] = deriveMarket(BigInt(newDemoFixtureId));
  const vault = getAssociatedTokenAddressSync(usdcMint, market, true);
  const home = truncateToBytes(rest.fixture.Participant1IsHome ? rest.fixture.Participant1 : rest.fixture.Participant2, 24);
  const away = truncateToBytes(rest.fixture.Participant1IsHome ? rest.fixture.Participant2 : rest.fixture.Participant1, 24);

  const tx = await program.methods
    .initializeMarket(new BN(newDemoFixtureId), home, away, new BN(kickoffTs))
    .accountsStrict({
      authority: devWallet.publicKey,
      market,
      usdcMint,
      vault,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();
  tx.feePayer = devWallet.publicKey;
  const txSig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [devWallet], { commitment: "confirmed" });

  console.log(`\n✅ fresh market for "${scenarioName}" — fixture ${newDemoFixtureId}`);
  console.log(`   ${home} v ${away}, kickoff in ${kickoffBufferSeconds}s (${new Date(kickoffTs * 1000).toISOString()})`);
  console.log(`   market: ${market.toBase58()} — ${txSig}`);
  console.log(`\n⚠️  restart the Next.js dev server now (loadDemoScenarios() caches the old data)`);
  console.log(`   then open: /matches/${newDemoFixtureId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

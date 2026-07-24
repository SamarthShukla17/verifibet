import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";
import { createHash } from "crypto";
import { Verifibet } from "../target/types/verifibet";

// Sentinel that flips mock-txline's `validate_stat` from "always succeed" to
// "always fail" — see anchor/programs/mock-txline/src/lib.rs. resolve_market
// forwards its `ts` arg to the CPI verbatim, so this is the only test hook
// needed to force a CPI failure without a second instruction.
const FORCE_FAIL_TS = -1;

const MARKET_SEED = Buffer.from("market");
const BET_SEED = Buffer.from("bet");
const DAILY_ROOTS_SEED = Buffer.from("daily_scores_roots");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("verifibet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.Verifibet as Program<Verifibet>;
  const mockTxline = anchor.workspace.MockTxline as Program<any>;

  const payer = (provider.wallet as anchor.Wallet).payer;

  // anchor/scripts/build-idl.sh's workaround for this machine's broken
  // `anchor build` IDL step (see CLAUDE.md) emits fully-qualified Rust paths
  // as account/type names ("verifibet::state::Market") instead of the bare
  // "Market" the normal Anchor toolchain would produce. `Program`'s runtime
  // camelCase pass lowercases each `::`-separated segment individually
  // ("verifibet::state::market") but the *compile-time* `Verifibet` type
  // (mirroring the raw IDL JSON verbatim) still has the capitalized
  // "verifibet::state::Market" — the two don't line up, so
  // `program.account.market` doesn't exist at either name consistently.
  // Casting through `any` once here to fetch by the real runtime key sidesteps
  // that mismatch without touching the underlying (documented, deliberate)
  // build tradeoff.
  const marketAccount = (program.account as any)["verifibet::state::market"];
  const betAccount = (program.account as any)["verifibet::state::bet"];

  // The mock's `daily_scores_merkle_roots` PDA is only ever an unchecked
  // account-address check (see resolve_market.rs); every test resolves at
  // epoch day 0 (`ts` of either 0 or FORCE_FAIL_TS both truncate to day 0 in
  // the on-chain `(ts / MS_PER_DAY).clamp(...)` expression), so one PDA
  // covers every call.
  const [dailyRootsPda] = PublicKey.findProgramAddressSync(
    [DAILY_ROOTS_SEED, Buffer.from([0, 0])],
    mockTxline.programId
  );

  let usdcMint: PublicKey;
  let userA: Keypair;
  let userB: Keypair;
  let userC: Keypair;

  let fixtureCounter = 1;
  const freshFixtureId = () => new BN(fixtureCounter++);

  function marketPda(fixtureId: BN): PublicKey {
    return PublicKey.findProgramAddressSync(
      [MARKET_SEED, fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  }

  function betPda(market: PublicKey, user: PublicKey, outcome: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [BET_SEED, market.toBuffer(), user.toBuffer(), Buffer.from([outcome])],
      program.programId
    )[0];
  }

  function vaultAta(market: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(usdcMint, market, true);
  }

  async function airdrop(pubkey: PublicKey, sol = 5) {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  }

  async function userUsdcBalance(user: PublicKey): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(usdcMint, user);
    const acc = await getAccount(connection, ata);
    return acc.amount;
  }

  function statusKey(status: unknown): string {
    return Object.keys(status as object)[0];
  }

  async function initMarket(opts: {
    fixtureId: BN;
    kickoffTs: number;
    home?: string;
    away?: string;
  }): Promise<{ market: PublicKey; vault: PublicKey }> {
    const market = marketPda(opts.fixtureId);
    const vault = vaultAta(market);
    await program.methods
      .initializeMarket(
        opts.fixtureId,
        opts.home ?? "Home",
        opts.away ?? "Away",
        new BN(opts.kickoffTs)
      )
      .accountsStrict({
        authority: payer.publicKey,
        market,
        usdcMint,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { market, vault };
  }

  async function placeBet(opts: {
    market: PublicKey;
    user: Keypair;
    outcome: number;
    amount: number;
    userUsdc?: PublicKey;
  }) {
    const userUsdc = opts.userUsdc ?? getAssociatedTokenAddressSync(usdcMint, opts.user.publicKey);
    const bet = betPda(opts.market, opts.user.publicKey, opts.outcome);
    return program.methods
      .placeBet(opts.outcome, new BN(opts.amount))
      .accountsStrict({
        user: opts.user.publicKey,
        market: opts.market,
        bet,
        userUsdc,
        usdcMint,
        vault: vaultAta(opts.market),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([opts.user])
      .rpc();
  }

  function statTerm(key: number, value: number) {
    return {
      statToProve: { key, value, period: 100 },
      eventStatRoot: new Array(32).fill(0),
      statProof: [] as never[],
    };
  }

  async function resolveMarket(opts: {
    market: PublicKey;
    outcome: number;
    homeValue: number;
    awayValue: number;
    forceFail?: boolean;
    authority?: Keypair;
  }) {
    const ts = opts.forceFail ? FORCE_FAIL_TS : 0;
    const fixtureSummary = {
      fixtureId: new BN(1),
      updateStats: { updateCount: 1, minTimestamp: new BN(0), maxTimestamp: new BN(0) },
      eventsSubTreeRoot: new Array(32).fill(7),
    };
    const authorityPk = opts.authority?.publicKey ?? payer.publicKey;
    const builder = program.methods
      .resolveMarket(
        opts.outcome,
        new BN(ts),
        fixtureSummary,
        [],
        [],
        statTerm(1, opts.homeValue),
        statTerm(2, opts.awayValue)
      )
      .accountsStrict({
        authority: authorityPk,
        market: opts.market,
        txlineProgram: mockTxline.programId,
        dailyScoresMerkleRoots: dailyRootsPda,
      });
    if (opts.authority) builder.signers([opts.authority]);
    return builder.rpc();
  }

  async function claimWinnings(opts: { market: PublicKey; user: Keypair; outcome: number }) {
    const bet = betPda(opts.market, opts.user.publicKey, opts.outcome);
    return program.methods
      .claimWinnings()
      .accountsStrict({
        user: opts.user.publicKey,
        market: opts.market,
        bet,
        vault: vaultAta(opts.market),
        userUsdc: getAssociatedTokenAddressSync(usdcMint, opts.user.publicKey),
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([opts.user])
      .rpc();
  }

  async function voidMarket(opts: { market: PublicKey }) {
    return program.methods
      .voidMarket()
      .accountsStrict({ authority: payer.publicKey, market: opts.market })
      .rpc();
  }

  async function claimRefund(opts: { market: PublicKey; user: Keypair; outcome: number }) {
    const bet = betPda(opts.market, opts.user.publicKey, opts.outcome);
    return program.methods
      .claimRefund()
      .accountsStrict({
        user: opts.user.publicKey,
        market: opts.market,
        bet,
        vault: vaultAta(opts.market),
        userUsdc: getAssociatedTokenAddressSync(usdcMint, opts.user.publicKey),
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([opts.user])
      .rpc();
  }

  /** Asserts `p` rejects with the named VerifibetError variant. */
  async function expectVerifibetError(p: Promise<unknown>, code: string) {
    try {
      await p;
    } catch (e) {
      if (e instanceof anchor.AnchorError) {
        expect(e.error.errorCode.code).to.equal(code);
        return;
      }
      expect(String((e as Error).message ?? e)).to.include(code);
      return;
    }
    assert.fail(`expected ${code} but the transaction succeeded`);
  }

  before(async () => {
    usdcMint = await createMint(connection, payer, payer.publicKey, null, 6);

    userA = Keypair.generate();
    userB = Keypair.generate();
    userC = Keypair.generate();
    await Promise.all([airdrop(userA.publicKey), airdrop(userB.publicKey), airdrop(userC.publicKey)]);

    for (const user of [userA, userB, userC]) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, user.publicKey);
      await mintTo(connection, payer, usdcMint, ata.address, payer, 1_000_000_000); // 1000 USDC
    }
  });

  describe("initialize_market", () => {
    it("init happy: all fields set, vault ATA owned by the market PDA", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market, vault } = await initMarket({ fixtureId, kickoffTs, home: "France", away: "Argentina" });

      const marketAcc = await marketAccount.fetch(market);
      expect(marketAcc.authority.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(marketAcc.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
      expect(marketAcc.fixtureId.toString()).to.equal(fixtureId.toString());
      expect(marketAcc.home).to.equal("France");
      expect(marketAcc.away).to.equal("Argentina");
      expect(marketAcc.kickoffTs.toNumber()).to.equal(kickoffTs);
      expect(statusKey(marketAcc.status)).to.equal("open");
      expect(marketAcc.outcome).to.equal(255);
      expect(marketAcc.pools.map((p: BN) => p.toNumber())).to.deep.equal([0, 0, 0]);
      expect(marketAcc.totalPool.toNumber()).to.equal(0);
      expect(Buffer.from(marketAcc.proofHash).equals(Buffer.alloc(32))).to.equal(true);
      expect(marketAcc.resolvedAt.toNumber()).to.equal(0);

      const vaultAcc = await getAccount(connection, vault);
      expect(vaultAcc.owner.toBase58()).to.equal(market.toBase58());
      expect(vaultAcc.mint.toBase58()).to.equal(usdcMint.toBase58());
      expect(vaultAcc.amount).to.equal(0n);
    });

    it("init past kickoff fails with KickoffPassed", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) - 60;
      await expectVerifibetError(initMarket({ fixtureId, kickoffTs }), "KickoffPassed");
    });
  });

  describe("place_bet", () => {
    it("two users x two outcomes: pools and vault balance are exact", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market, vault } = await initMarket({ fixtureId, kickoffTs });

      await placeBet({ market, user: userA, outcome: 0, amount: 100_000000 });
      await placeBet({ market, user: userA, outcome: 1, amount: 40_000000 });
      await placeBet({ market, user: userB, outcome: 0, amount: 30_000000 });
      await placeBet({ market, user: userB, outcome: 1, amount: 20_000000 });

      const marketAcc = await marketAccount.fetch(market);
      const pools = marketAcc.pools.map((p: BN) => p.toNumber());
      expect(pools).to.deep.equal([130_000000, 60_000000, 0]);
      expect(marketAcc.totalPool.toNumber()).to.equal(190_000000);

      const vaultAcc = await getAccount(connection, vault);
      expect(vaultAcc.amount).to.equal(190_000000n);

      const betA0 = await betAccount.fetch(betPda(market, userA.publicKey, 0));
      expect(betA0.amount.toNumber()).to.equal(100_000000);
      const betB1 = await betAccount.fetch(betPda(market, userB.publicKey, 1));
      expect(betB1.amount.toNumber()).to.equal(20_000000);
    });

    it("re-betting the same outcome accumulates into the same Bet PDA", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market } = await initMarket({ fixtureId, kickoffTs });

      await placeBet({ market, user: userA, outcome: 0, amount: 10_000000 });
      const betAddrBefore = betPda(market, userA.publicKey, 0);
      const before = await betAccount.fetch(betAddrBefore);

      await placeBet({ market, user: userA, outcome: 0, amount: 5_000000 });
      const betAddrAfter = betPda(market, userA.publicKey, 0);
      const after = await betAccount.fetch(betAddrAfter);

      expect(betAddrAfter.toBase58()).to.equal(betAddrBefore.toBase58());
      expect(after.amount.toNumber()).to.equal(before.amount.toNumber() + 5_000000);

      const marketAcc = await marketAccount.fetch(market);
      expect(marketAcc.pools[0].toNumber()).to.equal(15_000000);
    });

    it("outcome 3 fails with InvalidOutcome", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market } = await initMarket({ fixtureId, kickoffTs });

      await expectVerifibetError(
        placeBet({ market, user: userA, outcome: 3, amount: 1_000000 }),
        "InvalidOutcome"
      );
    });

    it("a token account for the wrong mint fails with MintMismatch", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market } = await initMarket({ fixtureId, kickoffTs });

      const wrongMint = await createMint(connection, payer, payer.publicKey, null, 6);
      const wrongAta = await getOrCreateAssociatedTokenAccount(connection, payer, wrongMint, userA.publicKey);
      await mintTo(connection, payer, wrongMint, wrongAta.address, payer, 1_000000);

      await expectVerifibetError(
        placeBet({ market, user: userA, outcome: 0, amount: 1_000000, userUsdc: wrongAta.address }),
        "MintMismatch"
      );
    });

    it("betting after kickoff fails with KickoffPassed", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3;
      const { market } = await initMarket({ fixtureId, kickoffTs });

      await sleep(4000);

      await expectVerifibetError(
        placeBet({ market, user: userA, outcome: 0, amount: 1_000000 }),
        "KickoffPassed"
      );
    });
  });

  describe("resolve_market guards", () => {
    it("resolve by a non-authority signer fails with Unauthorized", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market } = await initMarket({ fixtureId, kickoffTs });

      await expectVerifibetError(
        resolveMarket({ market, outcome: 0, homeValue: 2, awayValue: 1, authority: userA }),
        "Unauthorized"
      );
    });

    it("resolve before kickoff fails with KickoffNotPassed", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3600;
      const { market } = await initMarket({ fixtureId, kickoffTs });

      await expectVerifibetError(
        resolveMarket({ market, outcome: 0, homeValue: 2, awayValue: 1 }),
        "KickoffNotPassed"
      );
    });
  });

  describe("resolve + claim lifecycle", () => {
    let market: PublicKey;
    const fixtureId = freshFixtureId();

    before(async () => {
      const kickoffTs = Math.floor(Date.now() / 1000) + 3;
      ({ market } = await initMarket({ fixtureId, kickoffTs }));
      await placeBet({ market, user: userA, outcome: 0, amount: 100_000000 });
      await placeBet({ market, user: userB, outcome: 1, amount: 50_000000 });
      await sleep(4000);
    });

    it("resolving with a forced mock-CPI failure reverts and leaves the market unresolved", async () => {
      let threw = false;
      try {
        await resolveMarket({ market, outcome: 0, homeValue: 2, awayValue: 1, forceFail: true });
      } catch (e) {
        threw = true;
        expect(String((e as Error).message ?? e)).to.match(/ForcedFailure|forced failure/i);
      }
      expect(threw, "forced CPI failure should have reverted the transaction").to.equal(true);

      const marketAcc = await marketAccount.fetch(market);
      expect(statusKey(marketAcc.status)).to.equal("open");
    });

    it("resolves happily via the mock CPI", async () => {
      await resolveMarket({ market, outcome: 0, homeValue: 2, awayValue: 1 });

      const marketAcc = await marketAccount.fetch(market);
      expect(statusKey(marketAcc.status)).to.equal("resolved");
      expect(marketAcc.outcome).to.equal(0);
      expect(marketAcc.resolvedAt.toNumber()).to.be.greaterThan(0);

      const fixtureIdBuf = fixtureId.toArrayLike(Buffer, "le", 8);
      const homeValueBuf = Buffer.alloc(4);
      homeValueBuf.writeInt32LE(2, 0);
      const awayValueBuf = Buffer.alloc(4);
      awayValueBuf.writeInt32LE(1, 0);
      const eventsSubTreeRoot = Buffer.from(new Array(32).fill(7));
      const preimage = Buffer.concat([
        fixtureIdBuf,
        Buffer.from([0]), // outcome
        homeValueBuf,
        awayValueBuf,
        eventsSubTreeRoot,
      ]);
      const expectedHash = createHash("sha256").update(preimage).digest();
      expect(Buffer.from(marketAcc.proofHash).equals(expectedHash)).to.equal(true);
    });

    it("winner claim pays out the exact BigInt-computed share", async () => {
      const before = await userUsdcBalance(userA.publicKey);
      await claimWinnings({ market, user: userA, outcome: 0 });
      const after = await userUsdcBalance(userA.publicKey);

      // Sole winner of a 150 USDC total pool on a 100 USDC winning pool gets
      // 100 * 150 / 100 = 150 exactly.
      expect(after - before).to.equal(150_000000n);

      const betAcc = await betAccount.fetch(betPda(market, userA.publicKey, 0));
      expect(betAcc.claimed).to.equal(true);
    });

    it("double claim fails with AlreadyClaimed", async () => {
      await expectVerifibetError(claimWinnings({ market, user: userA, outcome: 0 }), "AlreadyClaimed");
    });

    it("a losing bet fails to claim with NotWinningBet", async () => {
      await expectVerifibetError(claimWinnings({ market, user: userB, outcome: 1 }), "NotWinningBet");
    });

    it("claim_refund on a Resolved (never voided) market fails with MarketNotVoided", async () => {
      // userB's bet was never claimed (it lost) and never refunded (this
      // market was resolved, not voided) — claim_refund must still reject
      // it purely on market.status, checked before anything about the bet
      // itself (see void_and_refund.rs: MarketNotVoided is asserted before
      // AlreadyClaimed).
      await expectVerifibetError(claimRefund({ market, user: userB, outcome: 1 }), "MarketNotVoided");
    });
  });

  describe("void + refund lifecycle", () => {
    // VOID_GRACE_PERIOD_SECS is shrunk to 3s under the `test-mock-txline`
    // feature this local-test build compiles with (see void_and_refund.rs)
    // so this suite can exercise both sides of the grace window for real
    // instead of waiting out the production 1-day period.
    let market: PublicKey;

    before(async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 2;
      ({ market } = await initMarket({ fixtureId, kickoffTs }));
      await placeBet({ market, user: userA, outcome: 0, amount: 70_000000 });
      await placeBet({ market, user: userB, outcome: 1, amount: 30_000000 });
      // Past kickoff (+2s) but still inside the 3s grace window.
      await sleep(3500);
    });

    it("voiding before the grace window elapses fails with TooEarlyToVoid", async () => {
      await expectVerifibetError(voidMarket({ market }), "TooEarlyToVoid");
    });

    it("claim_refund before the market is voided (still Open) fails with MarketNotVoided", async () => {
      await expectVerifibetError(claimRefund({ market, user: userA, outcome: 0 }), "MarketNotVoided");
    });

    it("void + refund returns every bettor's exact stake", async () => {
      // Now past kickoff + 3s grace.
      await sleep(3500);
      await voidMarket({ market });

      const marketAcc = await marketAccount.fetch(market);
      expect(statusKey(marketAcc.status)).to.equal("voided");

      const beforeA = await userUsdcBalance(userA.publicKey);
      await claimRefund({ market, user: userA, outcome: 0 });
      const afterA = await userUsdcBalance(userA.publicKey);
      expect(afterA - beforeA).to.equal(70_000000n);

      const beforeB = await userUsdcBalance(userB.publicKey);
      await claimRefund({ market, user: userB, outcome: 1 });
      const afterB = await userUsdcBalance(userB.publicKey);
      expect(afterB - beforeB).to.equal(30_000000n);
    });

    it("double refund fails with AlreadyClaimed", async () => {
      await expectVerifibetError(claimRefund({ market, user: userA, outcome: 0 }), "AlreadyClaimed");
    });

    it("claim_winnings on a Voided market fails with MarketNotResolved", async () => {
      // userA's bet is already refunded (bet.claimed == true) at this
      // point, but claim_winnings must reject on market.status alone,
      // checked before anything about the bet — see claim_winnings.rs:
      // MarketNotResolved is asserted before NotWinningBet/AlreadyClaimed.
      await expectVerifibetError(claimWinnings({ market, user: userA, outcome: 0 }), "MarketNotResolved");
    });
  });

  describe("conservation", () => {
    it("after every winner claims, the vault holds less than one unit of dust per winner", async () => {
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 3;
      const { market, vault } = await initMarket({ fixtureId, kickoffTs });

      await placeBet({ market, user: userA, outcome: 0, amount: 130_000000 });
      await placeBet({ market, user: userB, outcome: 0, amount: 170_000000 });
      await placeBet({ market, user: userC, outcome: 1, amount: 233_000000 });
      await sleep(4000);

      await resolveMarket({ market, outcome: 0, homeValue: 3, awayValue: 1 });

      const totalPool = 533_000000n;
      const winningPool = 300_000000n;
      const stakeA = 130_000000n;
      const stakeB = 170_000000n;
      const payoutA = (stakeA * totalPool) / winningPool;
      const payoutB = (stakeB * totalPool) / winningPool;
      const winnersCount = 2n;

      const beforeA = await userUsdcBalance(userA.publicKey);
      await claimWinnings({ market, user: userA, outcome: 0 });
      const afterA = await userUsdcBalance(userA.publicKey);
      expect(afterA - beforeA).to.equal(payoutA);

      const beforeB = await userUsdcBalance(userB.publicKey);
      await claimWinnings({ market, user: userB, outcome: 0 });
      const afterB = await userUsdcBalance(userB.publicKey);
      expect(afterB - beforeB).to.equal(payoutB);

      const vaultAcc = await getAccount(connection, vault);
      const remainder = totalPool - payoutA - payoutB;
      expect(vaultAcc.amount).to.equal(remainder);
      expect(vaultAcc.amount < winnersCount, `dust ${vaultAcc.amount} should be < ${winnersCount} winners`).to.equal(
        true
      );
    });

    it("void + refund: 3 users x 2 outcomes drains the vault to exactly 0, no dust", async () => {
      // Unlike claim_winnings' proportional, floor-rounded payout (the
      // case above — dust is expected there), a refund is always the
      // bettor's exact stake back with no division at all: sum of every
      // refund equals the total pool exactly, so once every bettor has
      // claimed, the vault must be *exactly* empty, not just "less than
      // one unit per claimant".
      const fixtureId = freshFixtureId();
      const kickoffTs = Math.floor(Date.now() / 1000) + 2;
      const { market, vault } = await initMarket({ fixtureId, kickoffTs });

      // 3 users, 2 outcomes (0 and 1 — Draw/outcome 2 untouched).
      await placeBet({ market, user: userA, outcome: 0, amount: 40_000000 });
      await placeBet({ market, user: userB, outcome: 1, amount: 25_000000 });
      await placeBet({ market, user: userC, outcome: 0, amount: 35_000000 });

      // Past kickoff (+2s) + the (test-mock-txline-shrunk) 3s void grace
      // period, with margin.
      await sleep(5500);
      await voidMarket({ market });

      const marketAcc = await marketAccount.fetch(market);
      expect(statusKey(marketAcc.status)).to.equal("voided");
      expect(marketAcc.totalPool.toNumber()).to.equal(100_000000);

      const beforeA = await userUsdcBalance(userA.publicKey);
      await claimRefund({ market, user: userA, outcome: 0 });
      const afterA = await userUsdcBalance(userA.publicKey);
      expect(afterA - beforeA).to.equal(40_000000n);

      const beforeB = await userUsdcBalance(userB.publicKey);
      await claimRefund({ market, user: userB, outcome: 1 });
      const afterB = await userUsdcBalance(userB.publicKey);
      expect(afterB - beforeB).to.equal(25_000000n);

      const beforeC = await userUsdcBalance(userC.publicKey);
      await claimRefund({ market, user: userC, outcome: 0 });
      const afterC = await userUsdcBalance(userC.publicKey);
      expect(afterC - beforeC).to.equal(35_000000n);

      const vaultAcc = await getAccount(connection, vault);
      expect(vaultAcc.amount).to.equal(0n);
    });
  });
});

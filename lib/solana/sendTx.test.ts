import { describe, expect, it } from "vitest";
import { AnchorError } from "@coral-xyz/anchor";
import { mapSendError } from "@/lib/solana/sendTx";

function anchorErrorFor(code: string, number: number): AnchorError {
  const logs = [
    `Program 11111111111111111111111111111111 invoke [1]`,
    `Program log: AnchorError occurred. Error Code: ${code}. Error Number: ${number}. Error Message: ${code}.`,
    `Program 11111111111111111111111111111111 failed`,
  ];
  const parsed = AnchorError.parse(logs);
  if (!parsed) throw new Error("test setup: AnchorError.parse returned null");
  return parsed;
}

describe("mapSendError", () => {
  it("maps every VerifibetError code from the IDL to human copy", () => {
    const cases: Array<[string, number, string]> = [
      ["MarketNotOpen", 6000, "This market isn't open for betting"],
      ["KickoffPassed", 6001, "Betting closed — match has kicked off"],
      ["KickoffNotPassed", 6002, "Match hasn't kicked off yet"],
      ["InvalidOutcome", 6003, "Invalid outcome selected"],
      ["MarketNotResolved", 6004, "Market hasn't resolved yet"],
      ["MarketNotVoided", 6005, "Market wasn't voided"],
      ["NotWinningBet", 6006, "This bet didn't win"],
      ["AlreadyClaimed", 6007, "You've already claimed this bet"],
      ["Unauthorized", 6008, "You're not authorized for this action"],
      ["ZeroAmount", 6009, "Enter an amount greater than zero"],
      ["MathOverflow", 6010, "That amount is too large"],
      ["TooEarlyToVoid", 6011, "Too early to void this market"],
      ["MintMismatch", 6012, "Wrong token account for this market"],
      ["NameTooLong", 6013, "Team name is too long"],
      ["InvalidStatProof", 6014, "Couldn't verify the match result"],
    ];

    for (const [code, number, expected] of cases) {
      const result = mapSendError(anchorErrorFor(code, number));
      expect(result).toEqual({ message: expected, silent: false });
    }
  });

  it("falls back to generic copy for an unrecognized program error code", () => {
    const result = mapSendError(anchorErrorFor("SomeFutureError", 6099));
    expect(result.silent).toBe(false);
    expect(result.message).toBe("Something went wrong sending your transaction");
  });

  it("maps a blockhash-expired RPC error", () => {
    expect(mapSendError(new Error("Transaction was not confirmed: block height exceeded"))).toEqual({
      message: "Network was slow — try again",
      silent: false,
    });
    expect(mapSendError(new Error("failed to send transaction: Blockhash not found"))).toEqual({
      message: "Network was slow — try again",
      silent: false,
    });
  });

  it("maps an insufficient-funds error to USDC-specific copy", () => {
    expect(mapSendError(new Error("Transfer: insufficient funds"))).toEqual({
      message: "Not enough USDC",
      silent: false,
    });
    expect(mapSendError(new Error("custom program error: insufficient lamports"))).toEqual({
      message: "Not enough USDC",
      silent: false,
    });
  });

  it("silently dismisses a user-rejected wallet popup instead of erroring", () => {
    const rejected = new Error("User rejected the request.");
    rejected.name = "WalletSignTransactionError";
    expect(mapSendError(rejected)).toEqual({ message: "", silent: true });

    const declined = new Error("User declined to sign");
    expect(mapSendError(declined)).toEqual({ message: "", silent: true });
  });

  it("falls back to generic copy for a totally unrecognized error", () => {
    expect(mapSendError(new Error("some unrelated RPC hiccup"))).toEqual({
      message: "Something went wrong sending your transaction",
      silent: false,
    });
    expect(mapSendError("not even an Error instance")).toEqual({
      message: "Something went wrong sending your transaction",
      silent: false,
    });
  });
});

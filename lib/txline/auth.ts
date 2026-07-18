import nacl from "tweetnacl";
import type { Keypair } from "@solana/web3.js";

import { txlineFetch, TxlineApiError } from "@/lib/txline/http";

// Server-only by convention — see the note in lib/txline/http.ts. This
// module signs with a raw Keypair secret key; never import it from a client
// component.

/** POST /auth/guest/start → an anonymous 30-day guest JWT. No auth required. */
export async function getGuestJwt(): Promise<string> {
  const response = await txlineFetch("/auth/guest/start", { method: "POST" });
  const data = (await response.json()) as { token: string };
  return data.token;
}

/**
 * Builds and signs the activation message TxLINE expects:
 * `${txSig}:${leagues.join(",")}:${jwt}`, ed25519-signed (tweetnacl detached)
 * by the same wallet that submitted the `subscribe` transaction, base64-encoded
 * (confirmed against TxODDS's OpenAPI spec and reference example — not
 * base58, despite that being the more common Solana convention).
 */
export function signActivation(
  txSig: string,
  leagues: number[],
  jwt: string,
  subscriber: Keypair,
): { message: string; walletSignature: string } {
  const message = `${txSig}:${leagues.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(message),
    subscriber.secretKey,
  );
  const walletSignature = Buffer.from(signatureBytes).toString("base64");
  return { message, walletSignature };
}

/**
 * POST /api/token/activate with the signed activation payload → a long-lived
 * API token (returned as `text/plain`, not JSON — handled defensively below
 * in case that ever changes to a `{ token }` JSON body).
 */
export async function activateToken(
  txSig: string,
  leagues: number[],
  jwt: string,
  subscriber: Keypair,
): Promise<string> {
  const { message, walletSignature } = signActivation(
    txSig,
    leagues,
    jwt,
    subscriber,
  );

  try {
    const response = await txlineFetch("/api/token/activate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ txSig, walletSignature, leagues }),
    });

    const raw = (await response.text()).trim();
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : parsed.token;
    } catch {
      return raw;
    }
  } catch (err) {
    if (err instanceof TxlineApiError && err.status === 401) {
      console.error(
        `[txline] 401 on activation — signed message was: ${JSON.stringify(message)}`,
      );
    }
    throw err;
  }
}

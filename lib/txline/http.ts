import { NETWORK } from "@/lib/config";

// Server-only by convention, not by the `server-only` package: that package
// throws unconditionally outside Next's bundler, which would break the
// `scripts/txline-*.ts` CLI scripts that import this module via `tsx`. Never
// import this from a client component — see CLAUDE.md's TxLINE conventions.

/**
 * Thrown for any non-2xx response from TxLINE. `body` is the raw response
 * text verbatim — TxODDS's off-chain API returns `text/plain` error bodies
 * (confirmed against its OpenAPI spec), not JSON.
 */
export class TxlineApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`TxLINE API error ${status}: ${body}`);
    this.name = "TxlineApiError";
    this.status = status;
    this.body = body;
  }
}

function apiOrigin(): string {
  return process.env.TXLINE_API_ORIGIN ?? NETWORK.apiOrigin;
}

/**
 * Fetch wrapper for TxLINE's off-chain API. Injects `Authorization: Bearer
 * <TXLINE_JWT>` and `X-Api-Token: <TXLINE_API_TOKEN>` from the environment
 * unless the caller already supplied that header (the bootstrap calls in
 * `lib/txline/auth.ts` haven't persisted those env vars yet, so they pass
 * `Authorization` explicitly). Server-only — never import this from a
 * client component.
 */
export async function txlineFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!headers.has("Authorization") && process.env.TXLINE_JWT) {
    headers.set("Authorization", `Bearer ${process.env.TXLINE_JWT}`);
  }
  if (!headers.has("X-Api-Token") && process.env.TXLINE_API_TOKEN) {
    headers.set("X-Api-Token", process.env.TXLINE_API_TOKEN);
  }

  const response = await fetch(`${apiOrigin()}${path}`, { ...init, headers });

  if (!response.ok) {
    const body = await response.text();
    throw new TxlineApiError(response.status, body);
  }

  return response;
}

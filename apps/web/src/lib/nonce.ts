import { headers } from "next/headers";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The per-request CSP nonce set by src/middleware.ts, for inline data blocks (JSON-LD).
 * Reading request headers makes the calling route render per request, which a nonce
 * CSP requires anyway (Next applies the same nonce to its own scripts).
 */
export async function getNonce(): Promise<string | undefined> {
  const nonce = (await headers()).get("x-nonce");
  return nonce && BASE64.test(nonce) ? nonce : undefined;
}

import { isIP } from "node:net";
import type { RequestHandler } from "express";
import { safeEqual } from "./crypto";

export const INTERNAL_TOKEN_HEADER = "X-Internal-Token";
export const FORWARDED_CLIENT_IP_HEADER = "X-HP-Client-IP";

/**
 * Resolves the address that per-IP limits key on (`req.clientIp`).
 *
 * The storefront renders pages on its own servers, so every SSR call arrives from the same
 * IP. When a request carries the shared internal token (constant-time compare) and a valid
 * IPv4/IPv6 address in X-HP-Client-IP, that end-user address is used. Otherwise the header
 * is ignored entirely and the connection address (req.ip, via TRUST_PROXY_HOPS) is used,
 * so public callers can't choose their own bucket. Without a configured token (local dev
 * and tests that don't set it) the header is never honoured.
 */
export function resolveClientAddress(internalToken: string | undefined): RequestHandler {
  return (req, _res, next) => {
    const presented = req.header(INTERNAL_TOKEN_HEADER);
    const internal =
      internalToken !== undefined && presented !== undefined && safeEqual(presented, internalToken);
    const forwarded = req.header(FORWARDED_CLIENT_IP_HEADER)?.trim();
    if (internal && forwarded !== undefined && isIP(forwarded) !== 0) {
      req.clientKind = "forwarded";
      req.clientIp = forwarded;
    } else if (internal && forwarded === undefined) {
      // Token-only: the storefront's cacheable public reads (no per-shopper header, so Next's
      // fetch cache isn't split per shopper). These share one "internal" bucket.
      req.clientKind = "internal";
      req.clientIp = req.ip;
    } else {
      req.clientKind = "direct";
      req.clientIp = req.ip;
    }
    next();
  };
}

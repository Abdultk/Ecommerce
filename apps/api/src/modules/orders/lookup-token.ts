import { createHmac } from "node:crypto";
import { env } from "../../config/env";
import { hashToken, safeEqual } from "../../lib/crypto";

const LABEL = "order-lookup:v1:";

/**
 * The guest lookup token is derived from the order id with a server secret, so it can be
 * shown on the success page and re-derived for the confirmation email without storing it.
 * Only its hash is stored; verification compares hashes in constant time. The key is a
 * dedicated secret, so rotating it (which invalidates emailed links) touches nothing else.
 */
export const lookupTokenFor = (orderId: string): string =>
  createHmac("sha256", env.ORDER_LOOKUP_SECRET)
    .update(LABEL + orderId)
    .digest("base64url");

export const lookupTokenHash = (token: string): string => hashToken(token);

/**
 * Re-derives the token from the CURRENT secret and compares in constant time, so rotating
 * ORDER_LOOKUP_SECRET revokes every earlier link. The stored hash only marks that a token
 * was issued for this order; it is never trusted on its own (it would survive a rotation).
 */
export const lookupTokenMatches = (
  token: string,
  order: { id: string; lookupTokenHash: string | null },
): boolean => order.lookupTokenHash !== null && safeEqual(token, lookupTokenFor(order.id));

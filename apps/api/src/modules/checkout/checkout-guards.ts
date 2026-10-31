import type { Request } from "express";
import type { CheckoutInput } from "@hp/contracts";
import { env } from "../../config/env";
import { clientKey } from "../../lib/client-key";
import { hashToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { fingerprint } from "../../lib/fingerprint";
import type { DbClient } from "../../lib/prisma";

/** Unpaid checkouts each hold stock, so how many may be open at once per shopper and per client. */
export type CheckoutCaps = { openPerEmail: number; openPerClient: number };

const TOO_MANY_OPEN =
  "You have too many checkouts waiting for payment. Finish one, or try again in a few minutes.";

/** Stock is held this long for an unpaid checkout (RESERVATION_TTL_MINUTES, default 15). */
export const reservationMs = (): number => env.RESERVATION_TTL_MINUTES * 60_000;

/**
 * Peppered hash of the client's rate-limit key (IPv4 address or IPv6 /64), so the count
 * works without storing addresses and the small IPv4 space can't be reversed from the table.
 */
export const clientHash = (req: Request): string =>
  hashToken(`checkout-client:${clientKey(req.clientIp ?? req.ip)}`, env.REFRESH_TOKEN_PEPPER);

/**
 * Fingerprint of a checkout attempt: the request body plus what is in the cart. A retry with
 * the same Idempotency-Key must match it, so a key can't replay an order for an edited cart.
 */
export async function checkoutFingerprint(
  db: DbClient,
  cart: { id: string; couponCode: string | null },
  input: CheckoutInput,
): Promise<string> {
  const lines = await db.cartItem.findMany({
    where: { cartId: cart.id },
    select: { variantId: true, quantity: true },
    orderBy: { variantId: "asc" },
  });
  return fingerprint({ input, lines, couponCode: cart.couponCode });
}

/** Who is checking out: an account, or a guest's email as typed from one client. */
export type Shopper = { userId: string | null; email: string; client: string };

/** Serialises checkouts per shopper and per client for the rest of the transaction. */
async function lockKey(tx: DbClient, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
}

const shopperKey = (s: Shopper) =>
  s.userId ? `checkout-user:${s.userId}` : `checkout-guest:${s.email.toLowerCase()}:${s.client}`;

async function openForShopper(tx: DbClient, s: Shopper, now: Date): Promise<number> {
  const rows = s.userId
    ? await tx.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "Order"
        WHERE "status" = 'PENDING_PAYMENT' AND "userId" = ${s.userId}
          AND "reservationExpiresAt" > ${now}`
    : await tx.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "Order"
        WHERE "status" = 'PENDING_PAYMENT' AND lower("email") = lower(${s.email})
          AND "checkoutIpHash" = ${s.client} AND "reservationExpiresAt" > ${now}`;
  return rows[0]?.n ?? 0;
}

async function openForClient(tx: DbClient, client: string, now: Date): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM "Order"
    WHERE "status" = 'PENDING_PAYMENT' AND "checkoutIpHash" = ${client}
      AND "reservationExpiresAt" > ${now}`;
  return rows[0]?.n ?? 0;
}

/** Takes the per-shopper and per-client locks. Call first in the transaction (fixed lock order). */
export async function lockShopper(tx: DbClient, shopper: Shopper): Promise<void> {
  await lockKey(tx, shopperKey(shopper));
  await lockKey(tx, `checkout-client:${shopper.client}`);
}

/**
 * Refuses a new checkout when this shopper or client already holds too much stock unpaid.
 * The per-shopper cap counts a signed-in account's checkouts, or for guests the checkouts
 * with that email FROM THIS CLIENT, so nobody can block a customer's checkout by opening
 * guest checkouts with their email elsewhere (security review M3). The per-client cap still
 * bounds what any one address can hold. Call after the cart's own earlier checkout has been
 * superseded, so it doesn't count.
 */
export async function enforceOpenCheckoutCaps(
  tx: DbClient,
  caps: CheckoutCaps,
  shopper: Shopper,
  now: Date,
): Promise<void> {
  if ((await openForShopper(tx, shopper, now)) >= caps.openPerEmail) {
    throw new AppError("RATE_LIMITED", TOO_MANY_OPEN);
  }
  if ((await openForClient(tx, shopper.client, now)) >= caps.openPerClient) {
    throw new AppError("RATE_LIMITED", TOO_MANY_OPEN);
  }
}

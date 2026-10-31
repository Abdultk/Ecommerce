import { z } from "zod";
import {
  type Cart,
  CheckoutIntent,
  ShippingOption,
  type CheckoutInput,
  type ShippingAddress,
} from "@hp/contracts";
import { endpoints, browserApi } from "./api";

/** Where Stripe (and Amwal Pay, configured on the API) send the shopper back. No token in it. */
export function checkoutReturnUrl(origin: string, orderNumber: string): string {
  const params = new URLSearchParams({ number: orderNumber });
  return `${origin}/checkout/return?${params.toString()}`;
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The hosted payment page URL, if it is safe to send the shopper there: https always,
 * plain http only to a local host outside production (the dev "fake" gateway).
 */
export function safePaymentRedirect(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.href;
  const localHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  return localHttp && !production ? url.href : null;
}

/** What the order is made of: lines (order-independent), coupon and server totals. */
export function checkoutFingerprint(input: CheckoutInput, cart: Cart): string {
  const lines = cart.items
    .map((line) => [line.variantId, line.quantity] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ input, lines, couponCode: cart.couponCode, totals: cart.totals });
}

/**
 * One Idempotency-Key per checkout attempt: retries and double-clicks with the same input
 * and cart reuse the key (so the API returns the same order); a changed address, shipping
 * or payment method, cart line, coupon or total is a new attempt with a new key. After a
 * failed attempt call reset(): the API answers a replayed key from a failed request with 409.
 */
export function createIdempotencyKeys() {
  let last: { key: string; fingerprint: string } | null = null;
  return {
    keyFor(input: CheckoutInput, cart: Cart): string {
      const fingerprint = checkoutFingerprint(input, cart);
      if (last?.fingerprint !== fingerprint) last = { key: crypto.randomUUID(), fingerprint };
      return last.key;
    },
    reset(): void {
      last = null;
    },
  };
}

export async function fetchShippingQuote(shippingAddress: ShippingAddress) {
  return (
    await browserApi.post("/checkout/shipping-quote", { shippingAddress }, z.array(ShippingOption))
  ).data;
}

export async function createCheckoutIntent(input: CheckoutInput, idempotencyKey: string) {
  return (
    await browserApi.post("/checkout/intent", input, CheckoutIntent, {
      "Idempotency-Key": idempotencyKey,
    })
  ).data;
}

/** The return page's poll; guests send their lookup token, signed-in owners none. */
export async function fetchCheckoutStatus(number: string, token: string | null) {
  return (await endpoints.checkout.status(token ? { number, token } : { number })).data.status;
}

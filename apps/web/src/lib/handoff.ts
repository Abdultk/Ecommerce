import { z } from "zod";

// Handoffs between client routes. The guest lookup token never goes into a URL: client-side
// navigation keeps it in memory, and a full-page payment redirect (Amwal Pay's payment page,
// Stripe) parks it in this tab's sessionStorage, which /checkout/return clears on reading.

export type PendingOrder = { orderNumber: string; lookupToken: string };

const STORAGE_KEY = "hp:pending-order";
const StoredOrder = z.object({ orderNumber: z.string(), lookupToken: z.string() });

let pendingOrder: PendingOrder | null = null;
let cartNotice: string | null = null;

/** Called right before a client-side navigation that hands the order to another route. */
export function setPendingOrder(order: PendingOrder): void {
  pendingOrder = order;
}

/** Called right before a payment page takes over the whole tab (Amwal Pay, Stripe). */
export function stashPendingOrderForRedirect(order: PendingOrder): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage blocked: the complete page falls back to "check your email".
  }
}

/** Drops a stash that will never be collected, e.g. when the card is declined on the spot. */
export function clearStashedOrder(): void {
  takeStashedOrder();
}

/** Reads and always removes the stashed order. */
function takeStashedOrder(): PendingOrder | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = StoredOrder.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Returns (and forgets) the pending order if it matches the number on the page. */
export function takePendingOrder(orderNumber: string): PendingOrder | null {
  const stashed = takeStashedOrder();
  const candidate = pendingOrder ?? stashed;
  pendingOrder = null;
  return candidate?.orderNumber === orderNumber ? candidate : null;
}

/** A message for the cart page, e.g. the API's OUT_OF_STOCK explanation. */
export function setCartNotice(message: string): void {
  cartNotice = message;
}

export function takeCartNotice(): string | null {
  const message = cartNotice;
  cartNotice = null;
  return message;
}

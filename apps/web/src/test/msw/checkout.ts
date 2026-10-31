import { http, HttpResponse } from "msw";
import { z } from "zod";
import {
  CheckoutInput,
  CheckoutIntent,
  CheckoutStatusInput,
  OrderDetail,
  OrderNumber,
  ShippingQuoteInput,
  ok,
  type Cart,
  type CheckoutPayment,
  type ShippingMethod,
} from "@hp/contracts";
import { buildOrder, findVariant, replaceOrder, statusEvent } from "./orders";
import {
  clearMockCart,
  errorResponse,
  readJson,
  readMockCart,
  requestUser,
  validationError,
  type MockOrder,
  type MockStore,
} from "./state";
import { MOCK_STORE_CONFIG, shippingOptions, transferDueAt } from "./store";

export { shippingOptions } from "./store";

/** Checking out with this email simulates a coupon that expired after it was applied. */
export const MOCK_COUPON_EXPIRED_EMAIL = "coupon-expired@example.test";
/** A card checkout with this email comes back from the hosted page declined (order cancelled). */
export const MOCK_CARD_DECLINED_EMAIL = "card-declined@example.test";

const DEFAULT_WEB_ORIGIN = "http://localhost:3000";

const priceFor = (method: ShippingMethod, goodsCents: number) =>
  shippingOptions(goodsCents).find((o) => o.method === method)?.priceCents ?? 0;

/** A guest lookup token: 32 hex characters, like the API's. */
const newLookupToken = () => crypto.randomUUID().replace(/-/g, "");

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,100}$/;
const FakeConfirmInput = z.object({ orderNumber: OrderNumber });

/** The page the fake hosted checkout "returns" to; the storefront's own origin in the browser. */
function returnUrl(number: string): string {
  const origin = globalThis.location?.origin ?? DEFAULT_WEB_ORIGIN;
  return `${origin}/checkout/return?${new URLSearchParams({ number }).toString()}`;
}

function paymentFor(detail: OrderDetail): CheckoutPayment {
  if (detail.bankTransfer) {
    return { kind: "bank_transfer", currency: detail.currency, ...detail.bankTransfer };
  }
  return { kind: "redirect", provider: "fake", redirectUrl: returnUrl(detail.number) };
}

function toIntent(order: MockOrder) {
  return CheckoutIntent.parse({
    orderNumber: order.detail.number,
    lookupToken: order.lookupToken,
    totals: order.detail.totals,
    currency: order.detail.currency,
    payment: paymentFor(order.detail),
  });
}

/**
 * A new intent for the (single) mock cart cancels any earlier unpaid card checkout, as the
 * API does. A placed bank-transfer order keeps its stock hold until it expires.
 */
function supersedePending(store: MockStore): void {
  const pending = store
    .get()
    .orders.filter(
      (o) =>
        o.idempotencyKey !== null &&
        o.detail.status === "PENDING_PAYMENT" &&
        o.detail.paymentMethod === "card",
    );
  for (const order of pending) {
    setStatus(store, order, "CANCELLED", "superseded", "Replaced by a newer checkout.");
  }
}

function setStatus(
  store: MockStore,
  order: MockOrder,
  to: "CANCELLED",
  type: string,
  message: string,
): OrderDetail {
  return replaceOrder(
    store,
    order.detail.number,
    OrderDetail.parse({
      ...order.detail,
      status: to,
      bankTransfer: null,
      events: [...order.detail.events, statusEvent(store, "PENDING_PAYMENT", to, type, message)],
    }),
  );
}

/** Stands in for markOrderPaid: commits stock, empties the cart, records the event. */
async function markPaid(store: MockStore, order: MockOrder): Promise<OrderDetail> {
  const paid = OrderDetail.parse({
    ...order.detail,
    status: "PAID",
    paidAt: new Date().toISOString(),
    bankTransfer: null,
    events: [
      ...order.detail.events,
      statusEvent(store, "PENDING_PAYMENT", "PAID", "payment_succeeded", "Payment received."),
    ],
  });
  store.update((s) => ({
    ...s,
    sold: order.detail.items.reduce(
      (sold, item) => ({ ...sold, [item.variantId]: (sold[item.variantId] ?? 0) + item.quantity }),
      s.sold,
    ),
  }));
  await clearMockCart(store.baseUrl);
  return replaceOrder(store, order.detail.number, paid);
}

const findOrder = (store: MockStore, number: string) =>
  store.get().orders.find((o) => o.detail.number === number);

/** First problem with the cart for this checkout, as an error response; null when fine. */
function cartProblem(store: MockStore, cart: Cart, email: string) {
  if (cart.items.length === 0) return errorResponse("VALIDATION_ERROR", "Your cart is empty.");
  if (email === MOCK_COUPON_EXPIRED_EMAIL) {
    return errorResponse(
      "COUPON_INVALID",
      "That coupon has expired. Remove it from your cart to continue.",
    );
  }
  for (const line of cart.items) {
    const found = findVariant(store.products, line.variantId);
    const stock = found ? found.variant.stockAvailable : 0;
    const left = stock - (store.get().sold[line.variantId] ?? 0);
    if (line.quantity > left) {
      return errorResponse("OUT_OF_STOCK", `Only ${left} left of ${line.productName}.`, {
        variantId: line.variantId,
        available: left,
      });
    }
  }
  return null;
}

function createOrder(
  store: MockStore,
  request: Request,
  input: CheckoutInput,
  cart: Cart,
  key: string | null,
): MockOrder {
  const now = new Date();
  const goods = cart.totals.subtotalCents - cart.totals.discountCents;
  const transfer = input.paymentMethod === "bank_transfer";
  const detail = buildOrder(store.products, {
    id: store.id("o"),
    sequence: store.get().nextOrderSequence,
    status: "PENDING_PAYMENT",
    email: input.email,
    lines: cart.items.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    shippingAddress: input.shippingAddress,
    shippingMethod: input.shippingMethod,
    shippingCents: priceFor(input.shippingMethod, goods),
    paymentMethod: input.paymentMethod,
    paymentDueAt: transfer ? transferDueAt(now) : null,
    createdAt: now.toISOString(),
    events: [statusEvent(store, null, "PENDING_PAYMENT", "created", "Order placed.")],
  });
  const order: MockOrder = {
    detail,
    ownerId: requestUser(request, store)?.id ?? null,
    lookupToken: newLookupToken(),
    idempotencyKey: key,
  };
  supersedePending(store);
  store.update((s) => ({
    ...s,
    orders: [...s.orders, order],
    nextOrderSequence: s.nextOrderSequence + 1,
  }));
  return order;
}

function intentHandler(store: MockStore) {
  return http.post(`${store.baseUrl}/checkout/intent`, async ({ request }) => {
    const parsed = CheckoutInput.safeParse(await readJson(request));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
    if (!MOCK_STORE_CONFIG.paymentMethods.includes(parsed.data.paymentMethod)) {
      return errorResponse(
        "PAYMENT_METHOD_UNAVAILABLE",
        "That payment method isn't available. Choose another.",
      );
    }
    // Same Idempotency-Key → same order, so a double-click never creates two.
    const key = request.headers.get("idempotency-key");
    if (key !== null && !IDEMPOTENCY_KEY.test(key)) {
      return errorResponse("VALIDATION_ERROR", "Invalid Idempotency-Key.");
    }
    const replay = key ? store.get().orders.find((o) => o.idempotencyKey === key) : undefined;
    if (replay) return HttpResponse.json(ok(toIntent(replay)));

    const cart = await readMockCart(store.baseUrl);
    const problem = cartProblem(store, cart, parsed.data.email);
    if (problem) return problem;
    const order = createOrder(store, request, parsed.data, cart, key);
    return HttpResponse.json(ok(toIntent(order)), { status: 201 });
  });
}

/** The return page's poll. The mock "asks the provider", which answers paid (or declined). */
function statusHandler(store: MockStore) {
  return http.post(`${store.baseUrl}/checkout/status`, async ({ request }) => {
    const parsed = CheckoutStatusInput.safeParse(await readJson(request));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
    const order = findOrder(store, parsed.data.number);
    const user = requestUser(request, store);
    const allowed =
      order &&
      ((user !== null && order.ownerId === user.id) || order.lookupToken === parsed.data.token);
    if (!order || !allowed) return errorResponse("NOT_FOUND", "We couldn't find that order.");

    const { detail } = order;
    if (detail.status !== "PENDING_PAYMENT" || detail.paymentMethod !== "card") {
      return HttpResponse.json(ok({ status: detail.status }));
    }
    const settled =
      detail.email === MOCK_CARD_DECLINED_EMAIL
        ? setStatus(store, order, "CANCELLED", "payment_failed", "Card payment declined.")
        : await markPaid(store, order);
    return HttpResponse.json(ok({ status: settled.status }));
  });
}

export function createCheckoutHandlers(store: MockStore) {
  const { baseUrl } = store;
  return [
    http.post(`${baseUrl}/checkout/shipping-quote`, async ({ request }) => {
      const parsed = ShippingQuoteInput.safeParse(await readJson(request));
      if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
      const cart = await readMockCart(baseUrl);
      const goods = cart.totals.subtotalCents - cart.totals.discountCents;
      return HttpResponse.json(ok(shippingOptions(goods)));
    }),

    intentHandler(store),
    statusHandler(store),

    // Dev/test shortcut: pays an order at once (the API's fake gateway does the same).
    http.post(`${baseUrl}/checkout/fake-confirm`, async ({ request }) => {
      const parsed = FakeConfirmInput.safeParse(await readJson(request));
      if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
      const order = findOrder(store, parsed.data.orderNumber);
      if (!order) return errorResponse("NOT_FOUND", "Order not found.");
      if (order.detail.status !== "PENDING_PAYMENT") return HttpResponse.json(ok(order.detail));
      return HttpResponse.json(ok(await markPaid(store, order)));
    }),
  ];
}

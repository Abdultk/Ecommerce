import { http, HttpResponse } from "msw";
import {
  CustomerOrderQuery,
  GuestOrderLookupInput,
  OrderDetail,
  formatOrderNumber,
  ok,
  paged,
  refundStateFor,
  type OrderEvent,
  type OrderStatus,
  type OrderSummary,
  type PaymentMethod,
  type ProductDetail,
  type ShippingMethod,
  type StoredAddress,
} from "@hp/contracts";
import {
  errorResponse,
  readJson,
  requestUser,
  unauthenticated,
  validationError,
  type MockOrder,
  type MockStore,
} from "./state";
import { MOCK_BANK, MOCK_STORE_CONFIG, vatFor } from "./store";

export const ORDER_YEAR = 2026;

export type OrderLineSeed = { variantId: string; quantity: number };

export type OrderSeed = {
  id: string;
  sequence: number;
  status: OrderStatus;
  email: string;
  lines: readonly OrderLineSeed[];
  shippingAddress: StoredAddress;
  shippingMethod: ShippingMethod;
  /** Defaults to card. */
  paymentMethod?: PaymentMethod;
  /** Transfer deadline; required for an unpaid bank-transfer order. */
  paymentDueAt?: string | null;
  shippingCents: number;
  createdAt: string;
  paidAt?: string | null;
  refundedCents?: number;
  trackingNumber?: string | null;
  events: readonly OrderEvent[];
};

export function findVariant(products: readonly ProductDetail[], variantId: string) {
  for (const product of products) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) return { product, variant };
  }
  return null;
}

/** Bank details are shown only while a transfer order waits for payment, as in the API. */
function transferFor(seed: OrderSeed, number: string, totalCents: number) {
  if (seed.paymentMethod !== "bank_transfer" || seed.status !== "PENDING_PAYMENT") return null;
  if (!seed.paymentDueAt) throw new Error(`Transfer order ${number} needs paymentDueAt`);
  return { reference: number, amountCents: totalCents, dueAt: seed.paymentDueAt, bank: MOCK_BANK };
}

/** Builds a contract-valid OrderDetail; totals come from catalog prices, as on the server. */
export function buildOrder(products: readonly ProductDetail[], seed: OrderSeed): OrderDetail {
  const items = seed.lines.map((line, index) => {
    const found = findVariant(products, line.variantId);
    if (!found) throw new Error(`Unknown variant ${line.variantId}`);
    return {
      id: `${seed.id}_item_${index + 1}`,
      variantId: found.variant.id,
      productName: found.product.name,
      variantName: found.variant.name,
      sku: found.variant.sku,
      unitPriceCents: found.variant.priceCents,
      quantity: line.quantity,
      lineTotalCents: found.variant.priceCents * line.quantity,
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const taxCents = vatFor(subtotalCents);
  const totalCents = subtotalCents + seed.shippingCents + taxCents;
  const refundedCents = seed.refundedCents ?? 0;
  const number = formatOrderNumber(ORDER_YEAR, seed.sequence);
  return OrderDetail.parse({
    id: seed.id,
    number,
    currency: MOCK_STORE_CONFIG.currency,
    paymentMethod: seed.paymentMethod ?? "card",
    paymentLabel: null,
    paymentDueAt: seed.paymentDueAt ?? null,
    manualPayment: null,
    bankTransfer: transferFor(seed, number, totalCents),
    status: seed.status,
    totalCents,
    itemCount: items.reduce((n, item) => n + item.quantity, 0),
    createdAt: seed.createdAt,
    email: seed.email,
    items,
    totals: {
      subtotalCents,
      discountCents: 0,
      shippingCents: seed.shippingCents,
      taxCents,
      totalCents,
    },
    refundedCents,
    refundState: refundStateFor(totalCents, refundedCents),
    shippingAddress: seed.shippingAddress,
    shippingMethod: seed.shippingMethod,
    trackingNumber: seed.trackingNumber ?? null,
    carrier: null,
    estimatedDeliveryAt: null,
    couponCode: null,
    paidAt: seed.paidAt ?? null,
    events: seed.events,
  });
}

export const toOrderSummary = (o: OrderDetail): OrderSummary => ({
  id: o.id,
  number: o.number,
  status: o.status,
  totalCents: o.totalCents,
  itemCount: o.itemCount,
  createdAt: o.createdAt,
  currency: o.currency,
  paymentMethod: o.paymentMethod,
  paymentLabel: o.paymentLabel,
  paymentDueAt: o.paymentDueAt,
});

/** History lists paid orders and transfer orders still waiting for payment. */
const listed = (o: OrderDetail): boolean =>
  o.paidAt !== null || (o.paymentMethod === "bank_transfer" && o.status === "PENDING_PAYMENT");

const CANCELLABLE: ReadonlySet<OrderStatus> = new Set(["PENDING_PAYMENT", "PAID"]);

export function statusEvent(
  store: MockStore,
  from: OrderStatus | null,
  to: OrderStatus,
  type: string,
  message: string | null,
): OrderEvent {
  return {
    id: store.id("ev"),
    type,
    fromStatus: from,
    toStatus: to,
    message,
    createdAt: new Date().toISOString(),
  };
}

/** Replaces one order in state (immutable update) and returns the new detail. */
export function replaceOrder(store: MockStore, number: string, detail: OrderDetail): OrderDetail {
  store.update((s) => ({
    ...s,
    orders: s.orders.map((o) => (o.detail.number === number ? { ...o, detail } : o)),
  }));
  return detail;
}

function cancelOrder(store: MockStore, order: MockOrder): OrderDetail {
  const { detail } = order;
  const wasPaid = detail.status === "PAID";
  const refundedCents = wasPaid ? detail.totalCents : detail.refundedCents;
  return replaceOrder(
    store,
    detail.number,
    OrderDetail.parse({
      ...detail,
      status: "CANCELLED",
      bankTransfer: null,
      refundedCents,
      refundState: refundStateFor(detail.totalCents, refundedCents),
      events: [
        ...detail.events,
        statusEvent(
          store,
          detail.status,
          "CANCELLED",
          "status_changed",
          wasPaid ? "Cancelled by customer. Payment refunded in full." : "Cancelled by customer.",
        ),
      ],
    }),
  );
}

const ownedOrder = (store: MockStore, userId: string, number: unknown) =>
  store.get().orders.find((o) => o.detail.number === number && o.ownerId === userId);

export function createOrderHandlers(store: MockStore) {
  const { baseUrl } = store;
  return [
    http.post(`${baseUrl}/orders/lookup`, async ({ request }) => {
      const parsed = GuestOrderLookupInput.safeParse(await readJson(request));
      if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
      const order = store
        .get()
        .orders.find(
          (o) => o.detail.number === parsed.data.number && o.lookupToken === parsed.data.token,
        );
      return order
        ? HttpResponse.json(ok(order.detail))
        : errorResponse("NOT_FOUND", "We couldn't find that order.");
    }),

    http.get(`${baseUrl}/orders`, ({ request }) => {
      const user = requestUser(request, store);
      if (!user) return unauthenticated();
      const url = new URL(request.url);
      const parsed = CustomerOrderQuery.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
      const { page, pageSize } = parsed.data;
      const mine = store
        .get()
        // Abandoned checkouts (never paid) are left out of the history, as in the API.
        .orders.filter((o) => o.ownerId === user.id && listed(o.detail))
        .map((o) => o.detail)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const start = (page - 1) * pageSize;
      return HttpResponse.json(
        paged(mine.slice(start, start + pageSize).map(toOrderSummary), {
          page,
          pageSize,
          total: mine.length,
        }),
      );
    }),

    http.get(`${baseUrl}/orders/:number`, ({ request, params }) => {
      const user = requestUser(request, store);
      if (!user) return unauthenticated();
      const order = ownedOrder(store, user.id, params.number);
      return order
        ? HttpResponse.json(ok(order.detail))
        : errorResponse("NOT_FOUND", "We couldn't find that order.");
    }),

    http.post(`${baseUrl}/orders/:number/cancel`, ({ request, params }) => {
      const user = requestUser(request, store);
      if (!user) return unauthenticated();
      const order = ownedOrder(store, user.id, params.number);
      if (!order) return errorResponse("NOT_FOUND", "We couldn't find that order.");
      if (!CANCELLABLE.has(order.detail.status)) {
        return errorResponse("CONFLICT", "This order can no longer be cancelled.");
      }
      return HttpResponse.json(ok(cancelOrder(store, order)));
    }),
  ];
}

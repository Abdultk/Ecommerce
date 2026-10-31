import type {
  Order,
  OrderEvent,
  OrderItem,
  PaymentMethod as PaymentMethodRow,
} from "@prisma/client";
import {
  BankDetails,
  CurrencyCode,
  PublicManualMethod,
  ShippingMethod,
  StoredAddress,
  refundStateFor,
  type BankTransferDetails,
  type ManualPaymentDetails,
  type OrderDetail,
  type OrderSummary,
  type PaymentMethod,
} from "@hp/contracts";

export type OrderWithLines = Order & { items: OrderItem[]; events: OrderEvent[] };

/** Prisma include that loads everything toOrderDetail needs. */
export const ORDER_DETAIL_INCLUDE = {
  items: { orderBy: { id: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
} as const;

const itemCount = (items: readonly OrderItem[]) => items.reduce((n, i) => n + i.quantity, 0);

const METHOD_OUT = { CARD: "card", BANK_TRANSFER: "bank_transfer", MANUAL: "manual" } as const;
const METHOD_IN = { card: "CARD", bank_transfer: "BANK_TRANSFER", manual: "MANUAL" } as const;

export const toPaymentMethod = (method: PaymentMethodRow): PaymentMethod => METHOD_OUT[method];

export const toPaymentMethodRow = (method: PaymentMethod): PaymentMethodRow => METHOD_IN[method];

/** Bank transfers and admin-defined methods have no provider: staff confirm the money by hand. */
export const isOffline = (method: PaymentMethodRow): boolean => method !== "CARD";

type PaymentFields = Pick<Order, "paymentMethod" | "status" | "reservationExpiresAt">;

/** True while an offline-payment order (bank transfer or manual method) waits for the money. */
export const awaitingTransfer = (o: PaymentFields): boolean =>
  isOffline(o.paymentMethod) && o.status === "PENDING_PAYMENT";

/** The label, instructions and id of an admin-defined method as they were at checkout. */
const manualSnapshotOf = (order: Pick<Order, "manualPayment">) => {
  const parsed = PublicManualMethod.safeParse(order.manualPayment);
  return parsed.success ? parsed.data : null;
};

/** The transfer deadline (stock is held until then); null for anything else. */
export const paymentDueAt = (o: PaymentFields): string | null =>
  awaitingTransfer(o) && o.reservationExpiresAt ? o.reservationExpiresAt.toISOString() : null;

/** The bank details the customer was given at checkout, while the transfer is awaited. */
export function bankTransferOf(
  order: Pick<Order, "number" | "totalCents" | "transferBank"> & PaymentFields,
): BankTransferDetails | null {
  const due = paymentDueAt(order);
  const bank = BankDetails.safeParse(order.transferBank);
  if (!due || order.paymentMethod !== "BANK_TRANSFER" || !bank.success) return null;
  return { reference: order.number, amountCents: order.totalCents, dueAt: due, bank: bank.data };
}

/** What the customer was told to do for an admin-defined method, while the payment is awaited. */
export function manualPaymentOf(
  order: Pick<Order, "number" | "totalCents" | "manualPayment"> & PaymentFields,
): ManualPaymentDetails | null {
  const due = paymentDueAt(order);
  const snapshot = manualSnapshotOf(order);
  if (!due || order.paymentMethod !== "MANUAL" || !snapshot) return null;
  return {
    reference: order.number,
    amountCents: order.totalCents,
    dueAt: due,
    label: snapshot.label,
    instructions: snapshot.instructions,
  };
}

/** The admin-defined method's name for a MANUAL order; null for card and bank transfer. */
export const paymentLabelOf = (order: Pick<Order, "paymentMethod" | "manualPayment">) =>
  order.paymentMethod === "MANUAL" ? (manualSnapshotOf(order)?.label ?? null) : null;

export const toOrderSummary = (order: Order & { items: OrderItem[] }): OrderSummary => ({
  paymentLabel: paymentLabelOf(order),
  id: order.id,
  number: order.number,
  status: order.status,
  totalCents: order.totalCents,
  itemCount: itemCount(order.items),
  createdAt: order.createdAt.toISOString(),
  currency: CurrencyCode.parse(order.currency),
  paymentMethod: toPaymentMethod(order.paymentMethod),
  paymentDueAt: paymentDueAt(order),
});

/** Maps a stored order to the contract shape shared by customers and admins. */
export function toOrderDetail(order: OrderWithLines): OrderDetail {
  return {
    ...toOrderSummary(order),
    email: order.email,
    items: order.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      sku: i.sku,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      lineTotalCents: i.lineTotalCents,
    })),
    totals: {
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
    },
    refundedCents: order.refundedCents,
    refundState: refundStateFor(order.totalCents, order.refundedCents),
    // Lenient: test orders from before the Oman switch hold US addresses.
    shippingAddress: StoredAddress.parse(order.shippingAddress),
    shippingMethod: ShippingMethod.parse(order.shippingMethod),
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
    estimatedDeliveryAt: order.estimatedDeliveryAt?.toISOString() ?? null,
    couponCode: order.couponCode,
    paidAt: order.paidAt?.toISOString() ?? null,
    events: order.events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
    bankTransfer: bankTransferOf(order),
    manualPayment: manualPaymentOf(order),
  };
}

import type { Order, OrderItem } from "@prisma/client";
import { CurrencyCode, StoredAddress, formatMoney, type BankDetails } from "@hp/contracts";
import { env } from "../../config/env";
import type { OutgoingMail } from "../../lib/mailer";
import { lookupTokenFor } from "./lookup-token";

/** Deadlines are shown in Oman time. */
const dueFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Muscat",
});
export const formatDue = (at: Date): string => `${dueFormat.format(at)} (Oman time)`;

/** Amounts in the currency the order was placed in. */
const moneyFor = (order: Pick<Order, "currency">) => {
  const currency = CurrencyCode.catch("OMR").parse(order.currency);
  return (cents: number) => formatMoney(cents, currency);
};

/**
 * The lookup link carries the token in the URL fragment, which browsers never send to a
 * server or put in a Referer header.
 */
export const orderLink = (order: Pick<Order, "id" | "number">): string =>
  `${env.WEB_ORIGIN}/orders/${order.number}#token=${lookupTokenFor(order.id)}`;

function summaryLines(order: Order & { items: OrderItem[] }): string[] {
  const money = moneyFor(order);
  return [
    ...order.items.map(
      (i) => `  ${i.quantity} × ${i.productName} (${i.variantName}) — ${money(i.lineTotalCents)}`,
    ),
    "",
    `Subtotal: ${money(order.subtotalCents)}`,
    ...(order.discountCents > 0 ? [`Discount: −${money(order.discountCents)}`] : []),
    `Shipping: ${money(order.shippingCents)}`,
    `VAT: ${money(order.taxCents)}`,
    `Total: ${money(order.totalCents)}`,
  ];
}

function paymentName(order: Order): string {
  if (order.paymentMethod === "CARD") return "Card";
  if (order.paymentMethod === "BANK_TRANSFER") return "Bank transfer";
  const label = (order.manualPayment as { label?: unknown } | null)?.label;
  return typeof label === "string" && label ? label : "Manual payment";
}

function addressLines(order: Order): string[] {
  const parsed = StoredAddress.safeParse(order.shippingAddress);
  if (!parsed.success) return [];
  const a = parsed.data;
  return [
    a.fullName,
    a.line1,
    ...(a.line2 ? [a.line2] : []),
    [a.city, a.region, a.postalCode].filter(Boolean).join(", "),
    ...(a.phone ? [a.phone] : []),
  ].map((line) => `  ${line}`);
}

/**
 * The receipt, sent once the payment is confirmed (card or an admin-confirmed offline payment):
 * what was bought, what was paid and how, where it goes, and what updates to expect.
 */
export function orderConfirmationEmail(order: Order & { items: OrderItem[] }): OutgoingMail {
  const paidAt = order.paidAt ?? order.createdAt;
  return {
    to: order.email,
    subject: `Your PAISLEY art receipt for order ${order.number}`,
    text: [
      "Thanks for your order! We've received your payment. This email is your receipt.",
      "",
      `Order: ${order.number}`,
      `Placed: ${formatDue(order.createdAt)}`,
      `Paid: ${formatDue(paidAt)} by ${paymentName(order)}`,
      `Delivery: ${order.shippingMethod === "express" ? "Express" : "Standard"}`,
      "",
      "Items:",
      ...summaryLines(order),
      "",
      "Delivering to:",
      ...addressLines(order),
      "",
      "We'll email you when your order ships, with the courier, tracking number and expected delivery date, and again when it's delivered.",
      "",
      `View your order any time: ${orderLink(order)}`,
    ].join("\n"),
  };
}

/** Sent when staff mark an order delivered. */
export function orderDeliveredEmail(
  order: Pick<Order, "id" | "email" | "number" | "carrier" | "trackingNumber">,
): OutgoingMail {
  const via = order.carrier ? ` with ${order.carrier}` : "";
  const tracking = order.trackingNumber ? `\nTracking number: ${order.trackingNumber}` : "";
  return {
    to: order.email,
    subject: `Your PAISLEY art order ${order.number} was delivered`,
    text: [
      `Your order has been delivered${via}.${tracking}`,
      "",
      "If something isn't right, reply to this email and we'll help.",
      "",
      `Details: ${orderLink(order)}`,
    ].join("\n"),
  };
}

/** Sent when a bank-transfer order is placed: where to pay, how much, the reference and deadline. */
export function transferInstructionsEmail(
  order: Order & { items: OrderItem[] },
  bank: BankDetails,
  dueAt: Date,
): OutgoingMail {
  const money = moneyFor(order);
  return {
    to: order.email,
    subject: `Pay by bank transfer for order ${order.number}`,
    text: [
      `Thanks for your order! Please transfer ${money(order.totalCents)} by ${formatDue(dueAt)}.`,
      "We hold your items until then; we'll confirm as soon as the money arrives.",
      "",
      `Amount: ${money(order.totalCents)}`,
      `Reference: ${order.number} (please include it in the transfer)`,
      `Bank: ${bank.bankName}`,
      `Account name: ${bank.accountName}`,
      `Account number: ${bank.accountNumber}`,
      `IBAN: ${bank.iban}`,
      ...(bank.swift ? [`SWIFT/BIC: ${bank.swift}`] : []),
      ...(bank.instructions ? ["", bank.instructions] : []),
      "",
      ...summaryLines(order),
      "",
      `View your order: ${orderLink(order)}`,
    ].join("\n"),
  };
}

/** Sent when an order is placed with an admin-defined method: what to do, how much, reference, deadline. */
export function manualPaymentEmail(
  order: Order & { items: OrderItem[] },
  method: { label: string; instructions: string },
  dueAt: Date,
): OutgoingMail {
  const money = moneyFor(order);
  return {
    to: order.email,
    subject: `Complete your payment (${method.label}) for order ${order.number}`,
    text: [
      `Thanks for your order! Please pay ${money(order.totalCents)} by ${formatDue(dueAt)} using ${method.label}.`,
      "We hold your items until then; we'll confirm as soon as we receive the payment.",
      "",
      `Amount: ${money(order.totalCents)}`,
      `Reference: ${order.number} (please quote it when you pay)`,
      "",
      method.instructions,
      "",
      ...summaryLines(order),
      "",
      `View your order: ${orderLink(order)}`,
    ].join("\n"),
  };
}

/** Sent when an offline-payment order is cancelled because the money didn't arrive in time. */
export function transferExpiredEmail(
  order: Pick<Order, "id" | "email" | "number" | "paymentMethod">,
): OutgoingMail {
  const what = order.paymentMethod === "BANK_TRANSFER" ? "bank transfer" : "payment";
  return {
    to: order.email,
    subject: `Your PAISLEY art order ${order.number} was cancelled`,
    text: [
      `We didn't receive your ${what} for order ${order.number} in time, so we've cancelled it and released the items.`,
      "If you already sent the money, reply to this email with your payment reference and we'll sort it out.",
      "",
      `Details: ${orderLink(order)}`,
    ].join("\n"),
  };
}

export function orderCancelledEmail(
  order: Pick<Order, "id" | "email" | "number" | "refundedCents" | "currency">,
): OutgoingMail {
  const refund =
    order.refundedCents > 0 ? ` We've refunded ${moneyFor(order)(order.refundedCents)}.` : "";
  return {
    to: order.email,
    subject: `Your PAISLEY art order ${order.number} was cancelled`,
    text: `Your order ${order.number} has been cancelled.${refund}\n\nDetails: ${orderLink(order)}`,
  };
}

export function orderShippedEmail(
  order: Pick<
    Order,
    "id" | "email" | "number" | "trackingNumber" | "carrier" | "estimatedDeliveryAt"
  >,
): OutgoingMail {
  const lines = [
    order.carrier && `Carrier: ${order.carrier}`,
    order.trackingNumber && `Tracking number: ${order.trackingNumber}`,
    order.estimatedDeliveryAt &&
      `Expected delivery: ${order.estimatedDeliveryAt.toISOString().slice(0, 10)}`,
  ].filter((line): line is string => Boolean(line));
  const details = lines.length > 0 ? `\n${lines.join("\n")}` : "";
  return {
    to: order.email,
    subject: `Your PAISLEY art order ${order.number} has shipped`,
    text: `Good news — your order is on its way.${details}\n\nDetails: ${orderLink(order)}`,
  };
}

export function lowStockEmail(
  to: string,
  variants: readonly { sku: string; available: number; threshold: number }[],
): OutgoingMail {
  return {
    to,
    subject: `Low stock: ${variants.map((v) => v.sku).join(", ")}`,
    text: [
      "These items are at or below their low-stock threshold:",
      "",
      ...variants.map((v) => `${v.sku}: ${v.available} available (alert at ${v.threshold})`),
      "",
      "You won't be alerted again for an item until it has been restocked above its threshold.",
    ].join("\n"),
  };
}

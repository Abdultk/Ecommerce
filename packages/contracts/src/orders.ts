import { z } from "zod";
import { Cents, Email, HttpUrl, Id, IsoDateTime, PositiveCents, Sku, Totals } from "./common";
import { CurrencyCode } from "./money";
import { BankDetails, ManualMethod, PaymentMethod } from "./settings";

// ---------- Status machine ----------

export const OrderStatus = z.enum([
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/**
 * Fulfillment transitions. PENDING_PAYMENT → PAID is deliberately absent and can never
 * be set through the status endpoint: it happens only in `markOrderPaid`, after a
 * verified provider confirmation (webhook, server-side status check or reconciliation)
 * or an admin-confirmed bank transfer.
 *
 * Partial refunds do not change status (a partly refunded order still ships);
 * they are tracked by `refundedCents` / `refundState`. A refund that brings
 * `refundedCents` up to the order total moves the order to REFUNDED.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    PENDING_PAYMENT: ["CANCELLED"],
    PAID: ["PROCESSING", "CANCELLED", "REFUNDED"],
    PROCESSING: ["SHIPPED", "CANCELLED", "REFUNDED"],
    SHIPPED: ["DELIVERED", "REFUNDED"],
    DELIVERED: ["REFUNDED"],
    CANCELLED: [],
    REFUNDED: [],
  });

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_TRANSITIONS[from].includes(to);

export const isTerminalStatus = (status: OrderStatus): boolean =>
  ORDER_TRANSITIONS[status].length === 0;

// ---------- Refunds ----------

export const REFUNDABLE_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;
const REFUNDABLE_SET: ReadonlySet<OrderStatus> = new Set(REFUNDABLE_STATUSES);

export const canRefund = (status: OrderStatus): boolean => REFUNDABLE_SET.has(status);

export const RefundState = z.enum(["NONE", "PARTIAL", "FULL"]);
export type RefundState = z.infer<typeof RefundState>;

export function refundStateFor(totalCents: number, refundedCents: number): RefundState {
  if (refundedCents < 0 || refundedCents > totalCents) {
    throw new RangeError(`Refunded ${refundedCents} is outside 0–${totalCents}`);
  }
  if (refundedCents === 0) return "NONE";
  return refundedCents === totalCents ? "FULL" : "PARTIAL";
}

// ---------- Order numbers ----------

export const ORDER_NUMBER_PATTERN = /^HP-\d{4}-\d{6}$/;
const MAX_ORDER_SEQUENCE = 999_999;
const MIN_YEAR = 2000;
const MAX_YEAR = 9999;

/** formatOrderNumber(2026, 123) → "HP-2026-000123" */
export function formatOrderNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Invalid order year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_ORDER_SEQUENCE) {
    throw new RangeError(`Order sequence must be 1–${MAX_ORDER_SEQUENCE}, got ${sequence}`);
  }
  return `HP-${year}-${String(sequence).padStart(6, "0")}`;
}

export const OrderNumber = z.string().regex(ORDER_NUMBER_PATTERN);

// ---------- Addresses & shipping (Oman) ----------

/** ISO 3166-2:OM governorates. */
export const OMAN_GOVERNORATES = [
  { code: "MA", name: "Muscat" },
  { code: "ZU", name: "Dhofar" },
  { code: "MU", name: "Musandam" },
  { code: "BU", name: "Al Buraimi" },
  { code: "DA", name: "Ad Dakhiliyah" },
  { code: "BS", name: "North Al Batinah" },
  { code: "BJ", name: "South Al Batinah" },
  { code: "SS", name: "North Ash Sharqiyah" },
  { code: "SJ", name: "South Ash Sharqiyah" },
  { code: "ZA", name: "Ad Dhahirah" },
  { code: "WU", name: "Al Wusta" },
] as const satisfies readonly { code: string; name: string }[];
export type GovernorateCode = (typeof OMAN_GOVERNORATES)[number]["code"];
const GOVERNORATE_CODES: ReadonlySet<string> = new Set(OMAN_GOVERNORATES.map((g) => g.code));

const PHONE_SEPARATORS = /[\s().-]/g;
// +968, 00968, or a bare 968 directly followed by the 8-digit number.
const OMAN_DIAL_PREFIX = /^(?:\+968|00968|968(?=\d{8}$))/;
// Mobiles start with 7 or 9, landlines with 2.
const OMAN_LOCAL_NUMBER = /^[279]\d{7}$/;

/** Omani phone number, normalised to E.164: "9123 4567" → "+96891234567". */
export const OmanPhone = z.string().transform((raw, ctx) => {
  const local = raw.replace(PHONE_SEPARATORS, "").replace(OMAN_DIAL_PREFIX, "");
  if (!OMAN_LOCAL_NUMBER.test(local)) {
    ctx.addIssue({ code: "custom", message: "Enter an Omani phone number, e.g. 9123 4567." });
    return z.NEVER;
  }
  return `+968${local}`;
});

/** Checkout/address-book input. Oman only: governorate, wilayat, optional 3-digit postal code. */
export const ShippingAddress = z.object({
  fullName: z.string().trim().min(1, "Required.").max(100),
  /** Area / street */
  line1: z.string().trim().min(1, "Required.").max(200),
  /** Building, flat, landmark */
  line2: z.string().trim().max(200).optional(),
  /** Wilayat */
  city: z.string().trim().min(1, "Required.").max(100),
  /** Governorate code (ISO 3166-2:OM) */
  region: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => GOVERNORATE_CODES.has(s), "Choose a governorate."),
  postalCode: z
    .string()
    .trim()
    .regex(/^(\d{3})?$/, "Postal codes in Oman have 3 digits.")
    .optional()
    .transform((s) => (s === "" ? undefined : s)),
  country: z.literal("OM", { errorMap: () => ({ message: "We ship within Oman only." }) }),
  phone: OmanPhone,
});
export type ShippingAddress = z.infer<typeof ShippingAddress>;

/**
 * Lenient read model for addresses already stored (orders, address book). Older
 * US-shaped test orders still parse; new data is always written through ShippingAddress.
 */
export const StoredAddress = z.object({
  fullName: z.string(),
  line1: z.string(),
  line2: z.string().nullish(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string().nullish(),
  country: z.string(),
  phone: z.string().nullish(),
});
export type StoredAddress = z.infer<typeof StoredAddress>;

export const SHIPPING_METHODS = ["standard", "express"] as const;
export const ShippingMethod = z.enum(SHIPPING_METHODS);
export type ShippingMethod = z.infer<typeof ShippingMethod>;

export const ShippingQuoteInput = z.object({ shippingAddress: ShippingAddress });

export const ShippingOption = z.object({
  method: ShippingMethod,
  label: z.string(),
  priceCents: Cents,
  estimatedDays: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
});
export type ShippingOption = z.infer<typeof ShippingOption>;

// ---------- Checkout ----------

/** The method must be enabled in store settings, else 422 PAYMENT_METHOD_UNAVAILABLE. */
export const CheckoutInput = z.object({
  email: Email,
  shippingAddress: ShippingAddress,
  shippingMethod: ShippingMethod,
  paymentMethod: PaymentMethod,
  /** Which admin-defined method, when paymentMethod is "manual" (else 422). */
  manualMethodId: ManualMethod.shape.id.optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;

/** Who took (or will take) the payment. "manual" = admin-confirmed bank transfer. */
export const PaymentProvider = z.enum(["amwal", "stripe", "fake", "manual"]);
export type PaymentProvider = z.infer<typeof PaymentProvider>;

/** What a customer needs to pay an order by bank transfer. `reference` is the order number. */
export const BankTransferDetails = z.object({
  reference: OrderNumber,
  amountCents: PositiveCents,
  dueAt: IsoDateTime,
  bank: BankDetails,
});
export type BankTransferDetails = z.infer<typeof BankTransferDetails>;

/**
 * What a customer needs to pay with an admin-defined method. `label` and `instructions` are the
 * snapshot taken at checkout, so later edits to the method never change an existing order.
 */
export const ManualPaymentDetails = z.object({
  reference: OrderNumber,
  amountCents: PositiveCents,
  dueAt: IsoDateTime,
  label: ManualMethod.shape.label,
  instructions: ManualMethod.shape.instructions,
});
export type ManualPaymentDetails = z.infer<typeof ManualPaymentDetails>;

/** How the storefront continues after POST /checkout/intent. */
export const CheckoutPayment = z.discriminatedUnion("kind", [
  /** Card via a hosted page (Amwal Pay; "fake" in dev/test). Never trust the redirect back. */
  z.object({
    kind: z.literal("redirect"),
    provider: z.enum(["amwal", "fake"]),
    redirectUrl: HttpUrl,
  }),
  /** Card via the Stripe Payment Element. */
  z.object({
    kind: z.literal("client_secret"),
    provider: z.literal("stripe"),
    clientSecret: z.string().min(1),
  }),
  /** Manual bank transfer: stock is held until `dueAt`. */
  BankTransferDetails.extend({ kind: z.literal("bank_transfer"), currency: CurrencyCode }),
  /** Admin-defined offline method: stock is held until `dueAt`, the admin confirms payment. */
  ManualPaymentDetails.extend({ kind: z.literal("manual"), currency: CurrencyCode }),
]);
export type CheckoutPayment = z.infer<typeof CheckoutPayment>;

export const CheckoutIntent = z
  .object({
    orderNumber: OrderNumber,
    /** Lets a guest look up this order; shown once and emailed. */
    lookupToken: z.string().min(16),
    totals: Totals,
    currency: CurrencyCode,
    payment: CheckoutPayment,
  })
  .superRefine((intent, ctx) => {
    const { payment } = intent;
    if (payment.kind !== "bank_transfer" && payment.kind !== "manual") return;
    const issue = (field: string, message: string) =>
      ctx.addIssue({ code: "custom", path: ["payment", field], message });
    if (payment.reference !== intent.orderNumber) issue("reference", "Must be the order number.");
    if (payment.amountCents !== intent.totals.totalCents)
      issue("amountCents", "Must be the total.");
    if (payment.currency !== intent.currency) issue("currency", "Must be the order currency.");
  });
export type CheckoutIntent = z.infer<typeof CheckoutIntent>;

/**
 * POST /checkout/status, polled by the return page. Guests send their lookup token;
 * signed-in owners need none. The server confirms with the provider before answering.
 */
export const CheckoutStatusInput = z.object({
  number: OrderNumber,
  token: z.string().min(16).max(128).optional(),
});
export type CheckoutStatusInput = z.infer<typeof CheckoutStatusInput>;

export const CheckoutStatus = z.object({ status: OrderStatus });
export type CheckoutStatus = z.infer<typeof CheckoutStatus>;

// ---------- Orders ----------

export const OrderItem = z
  .object({
    id: Id,
    variantId: Id,
    productName: z.string(),
    variantName: z.string(),
    sku: Sku,
    unitPriceCents: Cents,
    quantity: z.number().int().positive(),
    lineTotalCents: Cents,
  })
  .refine((i) => i.lineTotalCents === i.unitPriceCents * i.quantity, {
    path: ["lineTotalCents"],
    message: "Line total must equal unit price × quantity.",
  });
export type OrderItem = z.infer<typeof OrderItem>;

export const OrderEvent = z.object({
  id: Id,
  type: z.string(),
  fromStatus: OrderStatus.nullable(),
  toStatus: OrderStatus.nullable(),
  message: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type OrderEvent = z.infer<typeof OrderEvent>;

export const OrderSummary = z.object({
  id: Id,
  number: OrderNumber,
  status: OrderStatus,
  totalCents: Cents,
  itemCount: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
  /** The currency the order was placed in; amounts are its minor units. */
  currency: CurrencyCode,
  paymentMethod: PaymentMethod,
  /** The admin-defined method's name for "manual" orders; null for card and bank transfer. */
  paymentLabel: z.string().nullable(),
  /** Deadline for an unpaid bank transfer or manual payment; null otherwise. */
  paymentDueAt: IsoDateTime.nullable(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

type TransferCheck = {
  number: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  totalCents: number;
  bankTransfer: BankTransferDetails | null;
};

function checkBankTransfer(o: TransferCheck, issue: (path: string, message: string) => void) {
  if (o.bankTransfer === null) return;
  if (o.paymentMethod !== "bank_transfer" || o.status !== "PENDING_PAYMENT") {
    issue("bankTransfer", "Only for bank-transfer orders awaiting payment.");
  } else if (o.bankTransfer.amountCents !== o.totalCents) {
    issue("bankTransfer", "Amount must equal the order total.");
  } else if (o.bankTransfer.reference !== o.number) {
    issue("bankTransfer", "Reference must be the order number.");
  }
}

export const OrderDetail = OrderSummary.extend({
  email: z.string().email(),
  items: z.array(OrderItem),
  totals: Totals,
  refundedCents: Cents,
  refundState: RefundState,
  shippingAddress: StoredAddress,
  shippingMethod: ShippingMethod,
  trackingNumber: z.string().nullable(),
  /** Courier and expected arrival, as entered by staff when the order shipped. */
  carrier: z.string().nullable(),
  estimatedDeliveryAt: IsoDateTime.nullable(),
  couponCode: z.string().nullable(),
  paidAt: IsoDateTime.nullable(),
  events: z.array(OrderEvent),
  /** Present only while a bank-transfer order is PENDING_PAYMENT. */
  bankTransfer: BankTransferDetails.nullable(),
  /** Present only while a manual-method order is PENDING_PAYMENT. */
  manualPayment: ManualPaymentDetails.nullable(),
}).superRefine((o, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (o.totalCents !== o.totals.totalCents) issue("totalCents", "Must equal totals.totalCents.");
  if (o.itemCount !== o.items.reduce((n, i) => n + i.quantity, 0)) {
    issue("itemCount", "Must equal the total quantity of the items.");
  }
  if (o.totals.subtotalCents !== o.items.reduce((sum, i) => sum + i.lineTotalCents, 0)) {
    issue("totals", "Subtotal must equal the sum of the items.");
  }
  if (o.refundedCents > o.totalCents) {
    issue("refundedCents", "Cannot refund more than the order total.");
  } else if (o.refundState !== refundStateFor(o.totalCents, o.refundedCents)) {
    issue("refundState", "Does not match refundedCents.");
  }
  checkBankTransfer(o, issue);
  if (o.manualPayment !== null) {
    if (o.paymentMethod !== "manual" || o.status !== "PENDING_PAYMENT") {
      issue("manualPayment", "Only for manual-method orders awaiting payment.");
    } else if (o.manualPayment.amountCents !== o.totalCents) {
      issue("manualPayment", "Amount must equal the order total.");
    } else if (o.manualPayment.reference !== o.number) {
      issue("manualPayment", "Reference must be the order number.");
    }
  }
});
export type OrderDetail = z.infer<typeof OrderDetail>;

/** Sent in a POST body so the token stays out of URLs, access logs and Referer headers. */
export const GuestOrderLookupInput = z.object({
  number: OrderNumber,
  token: z.string().min(16).max(128),
});
export type GuestOrderLookupInput = z.infer<typeof GuestOrderLookupInput>;

export const CustomerOrderQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

import {
  OrderDetail,
  formatOrderNumber,
  refundStateFor,
  type OrderEvent,
  type OrderItem,
  type OrderStatus,
  type PaymentMethod,
  type ShippingAddress,
  type StoreSettings,
} from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";
import { toStoreMinor } from "./settings";
import type { MockOrder } from "./types";

// Twelve contract-valid OMR orders covering every status, built from the sample catalog and
// the seeded store settings (VAT, shipping rates). Order 01 awaits a bank transfer; order 03
// was paid by a transfer an admin confirmed; the rest were paid by card through Amwal Pay.

const HOUR_MS = 3_600_000;
const BPS = 10_000;
const NEWEST_ORDER_AT = Date.UTC(2026, 9, 9, 15);
const FIRST_SEQUENCE = 120;

type Buyer = { email: string; name: string; customerId: string | null };

const GUEST: Buyer = {
  email: "guest.cook@example.test",
  name: "Salim Al Harthy",
  customerId: null,
};
export const MOCK_CUSTOMERS = [
  { id: "u_mock_cust_1", email: "ada.cook@example.test", firstName: "Ada", lastName: "Cook" },
  { id: "u_mock_cust_2", email: "ben.ito@example.test", firstName: "Ben", lastName: "Ito" },
  { id: "u_mock_cust_3", email: "cleo.march@example.test", firstName: "Cleo", lastName: "March" },
] as const;

const buyer = (index: 0 | 1 | 2): Buyer => {
  const c = MOCK_CUSTOMERS[index];
  return { email: c.email, name: `${c.firstName} ${c.lastName}`, customerId: c.id };
};

type Seed = {
  status: OrderStatus;
  buyer: Buyer;
  /** [variantId, quantity] pairs */
  lines: [string, number][];
  method?: PaymentMethod;
  partialRefundCents?: number;
};

const SEEDS: readonly Seed[] = [
  {
    status: "PENDING_PAYMENT",
    buyer: GUEST,
    lines: [["v_sample_06_1", 2]],
    method: "bank_transfer",
  },
  {
    status: "PAID",
    buyer: buyer(0),
    lines: [
      ["v_sample_01_1", 1],
      ["v_sample_06_1", 1],
    ],
  },
  { status: "PAID", buyer: GUEST, lines: [["v_sample_04_1", 1]], method: "bank_transfer" },
  { status: "PROCESSING", buyer: buyer(1), lines: [["v_sample_02_1", 1]] },
  { status: "PROCESSING", buyer: buyer(2), lines: [["v_sample_07_1", 2]] },
  {
    status: "SHIPPED",
    buyer: buyer(0),
    lines: [
      ["v_sample_03_1", 1],
      ["v_sample_05_1", 1],
    ],
  },
  { status: "SHIPPED", buyer: GUEST, lines: [["v_sample_08_1", 1]] },
  {
    status: "DELIVERED",
    buyer: buyer(1),
    lines: [
      ["v_sample_01_2", 1],
      ["v_sample_06_1", 2],
    ],
    partialRefundCents: 10_000,
  },
  { status: "DELIVERED", buyer: buyer(2), lines: [["v_sample_05_2", 1]] },
  { status: "CANCELLED", buyer: GUEST, lines: [["v_sample_04_1", 2]] },
  { status: "REFUNDED", buyer: buyer(0), lines: [["v_sample_07_1", 1]] },
  { status: "DELIVERED", buyer: buyer(1), lines: [["v_sample_03_1", 2]] },
];

/** The statuses an order passes through after PENDING_PAYMENT to reach each status. */
const PATHS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: [],
  PAID: ["PAID"],
  PROCESSING: ["PAID", "PROCESSING"],
  SHIPPED: ["PAID", "PROCESSING", "SHIPPED"],
  DELIVERED: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"],
  CANCELLED: ["PAID", "CANCELLED"],
  REFUNDED: ["PAID", "PROCESSING", "REFUNDED"],
};

const ADDRESS: Omit<ShippingAddress, "fullName"> = {
  line1: "Way 3021, Al Khuwair",
  line2: "Building 12, Flat 4",
  city: "Bawshar",
  region: "MA",
  postalCode: "133",
  country: "OM",
  phone: "+96891234567",
};

const paidMessage = (method: PaymentMethod) =>
  method === "bank_transfer"
    ? "Bank transfer confirmed by an admin"
    : "Payment captured by Amwal Pay";

function eventsFor(id: string, seed: Seed, placedAt: number): OrderEvent[] {
  const steps = PATHS[seed.status];
  const placed: OrderEvent = {
    id: `${id}_ev_0`,
    type: "created",
    fromStatus: null,
    toStatus: "PENDING_PAYMENT",
    message: "Order placed",
    createdAt: new Date(placedAt).toISOString(),
  };
  return [
    placed,
    ...steps.map((to, i) => ({
      id: `${id}_ev_${i + 1}`,
      type: to === "PAID" ? "payment_succeeded" : "status_changed",
      fromStatus: i === 0 ? ("PENDING_PAYMENT" as const) : steps[i - 1]!,
      toStatus: to,
      message: to === "PAID" ? paidMessage(seed.method ?? "card") : null,
      createdAt: new Date(placedAt + (i + 1) * HOUR_MS).toISOString(),
    })),
  ];
}

type CatalogEntry = { productName: string; variantName: string; sku: string; price: number };

function catalogIndex(): ReadonlyMap<string, CatalogEntry> {
  return new Map(
    sampleCatalog().flatMap((p) =>
      p.variants.map((v) => [
        v.id,
        {
          productName: p.name,
          variantName: v.name,
          sku: v.sku,
          price: toStoreMinor(v.priceCents),
        },
      ]),
    ),
  );
}

function itemsFor(id: string, seed: Seed, catalog: ReadonlyMap<string, CatalogEntry>) {
  return seed.lines.map(([variantId, quantity], i): OrderItem => {
    const found = catalog.get(variantId);
    if (!found) throw new Error(`Unknown sample variant ${variantId}`);
    return {
      id: `${id}_item_${i + 1}`,
      variantId,
      productName: found.productName,
      variantName: found.variantName,
      sku: found.sku,
      unitPriceCents: found.price,
      quantity,
      lineTotalCents: found.price * quantity,
    };
  });
}

function totalsFor(items: readonly OrderItem[], express: boolean, settings: StoreSettings) {
  const { shipping, vatRateBps } = settings;
  const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
  const freeStandard =
    shipping.freeShippingThresholdCents !== null &&
    subtotalCents >= shipping.freeShippingThresholdCents;
  const shippingCents = express ? shipping.expressCents : freeStandard ? 0 : shipping.standardCents;
  const taxCents = Math.round((subtotalCents * vatRateBps) / BPS);
  const totalCents = subtotalCents + shippingCents + taxCents;
  return { subtotalCents, discountCents: 0, shippingCents, taxCents, totalCents };
}

type Context = { adminEmail: string; settings: StoreSettings };

function paymentFor(seed: Seed, index: number, number: string, placedAt: number, ctx: Context) {
  const method = seed.method ?? "card";
  const pending = seed.status === "PENDING_PAYMENT";
  const transfer = method === "bank_transfer";
  const dueAt = new Date(placedAt + ctx.settings.payments.bankTransferHoldHours * HOUR_MS);
  return {
    method,
    paymentDueAt: transfer && pending ? dueAt.toISOString() : null,
    provider: pending ? null : transfer ? ("manual" as const) : ("amwal" as const),
    paymentIntentId:
      !pending && !transfer ? `thw_pay_mock_${String(index + 1).padStart(4, "0")}` : null,
    transferBankReference: transfer && !pending ? `BMCT${String(number).slice(-6)}` : null,
    transferConfirmedByEmail: transfer && !pending ? ctx.adminEmail : null,
  };
}

function buildOrder(
  seed: Seed,
  index: number,
  catalog: ReadonlyMap<string, CatalogEntry>,
  ctx: Context,
): MockOrder {
  const id = `ord_mock_${String(index + 1).padStart(2, "0")}`;
  const number = formatOrderNumber(2026, FIRST_SEQUENCE - index);
  const placedAt = NEWEST_ORDER_AT - index * 7 * HOUR_MS;
  const items = itemsFor(id, seed, catalog);
  const totals = totalsFor(items, index % 3 === 0, ctx.settings);
  const refundedCents =
    seed.status === "REFUNDED" ? totals.totalCents : (seed.partialRefundCents ?? 0);
  const payment = paymentFor(seed, index, number, placedAt, ctx);
  const bank = ctx.settings.payments.bank;
  const order = OrderDetail.parse({
    id,
    number,
    status: seed.status,
    totalCents: totals.totalCents,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    createdAt: new Date(placedAt).toISOString(),
    currency: ctx.settings.currency,
    paymentMethod: payment.method,
    paymentLabel: null,
    paymentDueAt: payment.paymentDueAt,
    email: seed.buyer.email,
    items,
    totals,
    refundedCents,
    refundState: refundStateFor(totals.totalCents, refundedCents),
    shippingAddress: { ...ADDRESS, fullName: seed.buyer.name },
    shippingMethod: index % 3 === 0 ? "express" : "standard",
    trackingNumber: PATHS[seed.status].includes("SHIPPED")
      ? `OMP${String(9_100_200 + index)}`
      : null,
    carrier: null,
    estimatedDeliveryAt: null,
    couponCode: null,
    paidAt: payment.provider ? new Date(placedAt + HOUR_MS).toISOString() : null,
    events: eventsFor(id, seed, placedAt),
    bankTransfer:
      payment.paymentDueAt && bank
        ? { reference: number, amountCents: totals.totalCents, dueAt: payment.paymentDueAt, bank }
        : null,
    manualPayment: null,
  });
  return {
    order,
    customerId: seed.buyer.customerId,
    paymentIntentId: payment.paymentIntentId,
    paymentProvider: payment.provider,
    transferBankReference: payment.transferBankReference,
    transferConfirmedByEmail: payment.transferConfirmedByEmail,
    transferConfirmKey: null,
    refunds: refundsFor(id, seed, refundedCents, placedAt, ctx.adminEmail, payment.provider),
  };
}

function refundsFor(
  id: string,
  seed: Seed,
  refundedCents: number,
  placedAt: number,
  adminEmail: string,
  provider: MockOrder["paymentProvider"],
): MockOrder["refunds"] {
  if (refundedCents === 0 || provider === null) return [];
  return [
    {
      id: `${id}_refund_1`,
      amountCents: refundedCents,
      reason: seed.status === "REFUNDED" ? "Customer return" : "Damaged lid",
      actorEmail: adminEmail,
      createdAt: new Date(placedAt + 5 * HOUR_MS).toISOString(),
      provider,
      bankReference: null,
    },
  ];
}

export function seedOrders(adminEmail: string, settings: StoreSettings): MockOrder[] {
  const catalog = catalogIndex();
  return SEEDS.map((seed, index) => buildOrder(seed, index, catalog, { adminEmail, settings }));
}

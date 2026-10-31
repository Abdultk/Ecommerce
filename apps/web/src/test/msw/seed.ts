import {
  Review,
  type Address,
  type OrderEvent,
  type OrderStatus,
  type ProductDetail,
  type ShippingAddress,
} from "@hp/contracts";
import { buildOrder, type OrderSeed } from "./orders";
import type { MockOrder, MockState } from "./state";

// Realistic starting data for the signed-in mock customer, so the account area,
// order detail and reviews all have something to show in dev mode.

export const MOCK_USER_ID = "u_mock_0001";
/** Seeded orders below include this product, so the mock customer may review it. */
export const MOCK_REVIEWED_SLUG = "chefs-knife-8in";
export const FIRST_CHECKOUT_SEQUENCE = 1001;

const HOME: ShippingAddress = {
  fullName: "Ada Cook",
  line1: "Al Khuwair, Way 3021",
  line2: "Villa 12",
  city: "Bawshar",
  region: "MA",
  postalCode: "133",
  country: "OM",
  phone: "+96891234567",
};

const WORK: ShippingAddress = {
  fullName: "Ada Cook",
  line1: "Salalah Gardens, Street 23",
  line2: "Office 4, near the souq",
  city: "Salalah",
  region: "ZU",
  country: "OM",
  phone: "+96899887766",
};

const STANDARD_CENTS = 2_000;
const EXPRESS_CENTS = 5_000;

let eventSeq = 0;
const event = (
  from: OrderStatus | null,
  to: OrderStatus | null,
  type: string,
  createdAt: string,
  message: string | null = null,
): OrderEvent => ({
  id: `ev_seed_${String(++eventSeq).padStart(3, "0")}`,
  type,
  fromStatus: from,
  toStatus: to,
  message,
  createdAt,
});

function seedOrders(): OrderSeed[] {
  eventSeq = 0;
  return [
    {
      id: "o_seed_0001",
      sequence: 1,
      status: "DELIVERED",
      email: "ada@example.test",
      lines: [
        { variantId: "v_sample_01_1", quantity: 1 },
        { variantId: "v_sample_03_1", quantity: 1 },
        { variantId: "v_sample_06_1", quantity: 2 },
      ],
      shippingAddress: HOME,
      shippingMethod: "standard",
      shippingCents: STANDARD_CENTS,
      createdAt: "2026-08-14T15:02:00.000Z",
      paidAt: "2026-08-14T15:03:00.000Z",
      refundedCents: 1499,
      trackingNumber: "1Z999AA10123456784",
      events: [
        event(null, "PENDING_PAYMENT", "created", "2026-08-14T15:02:00.000Z", "Order placed."),
        event("PENDING_PAYMENT", "PAID", "payment_succeeded", "2026-08-14T15:03:00.000Z"),
        event("PAID", "PROCESSING", "status_changed", "2026-08-15T09:00:00.000Z"),
        event("PROCESSING", "SHIPPED", "shipped", "2026-08-15T17:30:00.000Z"),
        event("SHIPPED", "DELIVERED", "status_changed", "2026-08-19T12:10:00.000Z"),
        event(null, null, "refund", "2026-08-22T10:00:00.000Z", "Refunded one spatula set."),
      ],
    },
    {
      id: "o_seed_0002",
      sequence: 2,
      status: "SHIPPED",
      email: "ada@example.test",
      lines: [{ variantId: "v_sample_04_1", quantity: 1 }],
      shippingAddress: WORK,
      shippingMethod: "express",
      shippingCents: EXPRESS_CENTS,
      createdAt: "2026-09-20T18:45:00.000Z",
      paidAt: "2026-09-20T18:46:00.000Z",
      trackingNumber: "1Z999AA10123456791",
      events: [
        event(null, "PENDING_PAYMENT", "created", "2026-09-20T18:45:00.000Z", "Order placed."),
        event("PENDING_PAYMENT", "PAID", "payment_succeeded", "2026-09-20T18:46:00.000Z"),
        event("PAID", "PROCESSING", "status_changed", "2026-09-21T08:00:00.000Z"),
        event("PROCESSING", "SHIPPED", "shipped", "2026-09-21T16:20:00.000Z"),
      ],
    },
    {
      id: "o_seed_0003",
      sequence: 3,
      status: "PAID",
      email: "ada@example.test",
      lines: [{ variantId: "v_sample_07_1", quantity: 1 }],
      shippingAddress: HOME,
      shippingMethod: "standard",
      shippingCents: STANDARD_CENTS,
      createdAt: "2026-10-08T11:20:00.000Z",
      paidAt: "2026-10-08T11:21:00.000Z",
      events: [
        event(null, "PENDING_PAYMENT", "created", "2026-10-08T11:20:00.000Z", "Order placed."),
        event("PENDING_PAYMENT", "PAID", "payment_succeeded", "2026-10-08T11:21:00.000Z"),
      ],
    },
    {
      id: "o_seed_0004",
      sequence: 4,
      status: "PENDING_PAYMENT",
      email: "ada@example.test",
      lines: [{ variantId: "v_sample_06_1", quantity: 1 }],
      shippingAddress: HOME,
      shippingMethod: "standard",
      shippingCents: STANDARD_CENTS,
      createdAt: "2026-10-12T09:00:00.000Z",
      paymentMethod: "bank_transfer",
      paymentDueAt: "2026-10-13T09:00:00.000Z",
      events: [
        event(null, "PENDING_PAYMENT", "created", "2026-10-12T09:00:00.000Z", "Order placed."),
      ],
    },
  ];
}

const AUTHORS = ["Maya R.", "Theo B.", "Priya S.", "Jonah W.", "Lena K.", "Sam O.", "Grace T."];
const TITLES = [
  "Worth every penny",
  "Heats evenly",
  "Daily workhorse",
  "Great, with one quirk",
  "Gift for my brother",
  "Better than my old one",
  "Solid build",
];
const BODIES = [
  "I use it almost every day and it still looks great. Cleanup is easy if you follow the care guide.",
  "Took a couple of uses to get the hang of it, but now I reach for it first.",
  "Heavier than I expected, which turns out to be exactly why it works so well.",
  "Arrived well packed and on time. The finish is lovely.",
];
const MAX_SEEDED_REVIEWS = 7;

function seedReviews(products: readonly ProductDetail[]): Record<string, Review[]> {
  return Object.fromEntries(
    products.map((product, p) => {
      const count = Math.min(product.ratingCount, MAX_SEEDED_REVIEWS);
      const reviews = Array.from({ length: count }, (_, i) =>
        Review.parse({
          id: `rev_seed_${p + 1}_${i + 1}`,
          rating: [5, 5, 4, 5, 3, 4, 5][i] ?? 5,
          title: TITLES[i % TITLES.length],
          body: BODIES[(i + p) % BODIES.length],
          authorName: AUTHORS[(i + p) % AUTHORS.length],
          verifiedPurchase: i % 3 !== 2,
          createdAt: new Date(Date.UTC(2026, 8, 28 - i * 3, 12)).toISOString(),
        }),
      );
      return [product.slug, reviews];
    }),
  );
}

export function initialMockState(products: readonly ProductDetail[]): MockState {
  const orders: MockOrder[] = seedOrders().map((seed, i) => ({
    detail: buildOrder(products, seed),
    ownerId: MOCK_USER_ID,
    lookupToken: `seedlookuptoken${String(i + 1).padStart(4, "0")}`,
    idempotencyKey: null,
  }));
  const addresses: Address[] = [
    { ...HOME, id: "addr_seed_home", isDefault: true },
    { ...WORK, id: "addr_seed_work", isDefault: false },
  ];
  return {
    user: null,
    orders,
    addresses,
    wishlist: products
      .slice(1, 2)
      .map((p) => ({ productId: p.id, addedAt: "2026-09-30T08:00:00.000Z" })),
    reviews: seedReviews(products),
    reviewed: [`${MOCK_USER_ID}:${MOCK_REVIEWED_SLUG}`],
    sold: {},
    nextOrderSequence: FIRST_CHECKOUT_SEQUENCE,
    nextId: 0,
  };
}

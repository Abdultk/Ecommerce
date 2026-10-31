import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AdminImageInput,
  AdminOrderQuery,
  AdminProductInput,
  AdminProductQuery,
  AdminProductUpdate,
  AnalyticsRange,
  CouponInput,
  ReportJob,
} from "../src/admin";
import { Cart, CartLine } from "../src/cart";
import { ProductQuery } from "../src/catalog";
import { Cents, MAX_CENTS } from "../src/common";
import { envelope } from "../src/envelope";
import {
  GuestOrderLookupInput,
  ORDER_TRANSITIONS,
  OrderDetail,
  OrderStatus,
  REFUNDABLE_STATUSES,
  ShippingAddress,
  canRefund,
  refundStateFor,
} from "../src/orders";

// Regression tests for the Phase 0 code-review findings.

const variant = { sku: "LDG-SK10", name: "10 inch", priceCents: 3499 };
const product = {
  name: "Skillet",
  slug: "skillet",
  categoryId: "c1",
  description: "",
  variants: [variant],
};

describe("[HIGH] product updates never reset or set stock", () => {
  it("does not inject defaults into a patched existing variant", () => {
    const update = AdminProductUpdate.parse({ variants: [{ id: "v1", priceCents: 3999 }] });
    expect(update.variants?.[0]).toEqual({ id: "v1", priceCents: 3999 });
  });

  it("rejects stockOnHand on an existing variant patch", () => {
    const result = AdminProductUpdate.safeParse({ variants: [{ id: "v1", stockOnHand: 500 }] });
    expect(result.success).toBe(false);
  });

  it("rejects stockOnHand on a new variant; initial stock uses initialStock", () => {
    const withStock = { ...product, variants: [{ ...variant, stockOnHand: 5 }] };
    expect(AdminProductInput.safeParse(withStock).success).toBe(false);
    const withInitial = { ...product, variants: [{ ...variant, initialStock: 5 }] };
    expect(AdminProductInput.parse(withInitial).variants[0]).toMatchObject({ initialStock: 5 });
  });

  it("still validates compare-at price on a patch that sets both prices", () => {
    const result = AdminProductUpdate.safeParse({
      variants: [{ id: "v1", priceCents: 5000, compareAtPriceCents: 4000 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts brand-new variants alongside patches in an update", () => {
    const update = AdminProductUpdate.parse({
      variants: [
        { id: "v1", name: "10 in" },
        { ...variant, sku: "NEW-1" },
      ],
    });
    expect(update.variants).toHaveLength(2);
  });
});

describe("[MEDIUM] money and paging are bounded", () => {
  it("caps cents at Stripe's maximum charge", () => {
    expect(Cents.safeParse(MAX_CENTS).success).toBe(true);
    expect(Cents.safeParse(MAX_CENTS + 1).success).toBe(false);
    const huge = { ...product, variants: [{ ...variant, priceCents: 1e15 }] };
    expect(AdminProductInput.safeParse(huge).success).toBe(false);
  });

  it.each([{ page: "1e21" }, { page: "10001" }, { maxPrice: "1e21" }])("rejects %o", (query) => {
    expect(ProductQuery.safeParse(query).success).toBe(false);
  });

  it.each(["", "  "])("treats an empty price filter (%j) as absent", (blank) => {
    const q = ProductQuery.parse({ minPrice: blank, maxPrice: blank });
    expect(q.minPrice).toBeUndefined();
    expect(q.maxPrice).toBeUndefined();
  });
});

describe("[MEDIUM] envelope is a discriminated union", () => {
  it("rejects a success response with null data", () => {
    const body = { success: true, data: null, error: null };
    expect(envelope(z.object({ id: z.string() })).safeParse(body).success).toBe(false);
  });

  it("allows explicitly null data when the schema says so", () => {
    expect(envelope(z.null()).safeParse({ success: true, data: null, error: null }).success).toBe(
      true,
    );
  });
});

describe("[MEDIUM] refunds are tracked separately from fulfillment", () => {
  it("has no PARTIALLY_REFUNDED order status", () => {
    expect(OrderStatus.options).not.toContain("PARTIALLY_REFUNDED");
  });

  it("allows refunds before and after shipping", () => {
    expect([...REFUNDABLE_STATUSES].sort()).toEqual(["DELIVERED", "PAID", "PROCESSING", "SHIPPED"]);
    expect(canRefund("PAID")).toBe(true);
    expect(canRefund("PENDING_PAYMENT")).toBe(false);
    expect(canRefund("REFUNDED")).toBe(false);
  });

  it("lets every refundable status move to REFUNDED", () => {
    REFUNDABLE_STATUSES.forEach((s) => expect(ORDER_TRANSITIONS[s]).toContain("REFUNDED"));
  });

  it.each([
    [10_000, 0, "NONE"],
    [10_000, 2_500, "PARTIAL"],
    [10_000, 10_000, "FULL"],
  ] as const)("refundStateFor(%i, %i) is %s", (total, refunded, expected) => {
    expect(refundStateFor(total, refunded)).toBe(expected);
  });

  it("rejects refunding more than was paid", () => {
    expect(() => refundStateFor(10_000, 10_001)).toThrow(RangeError);
    expect(() => refundStateFor(10_000, -1)).toThrow(RangeError);
  });
});

describe("[MEDIUM] URLs and dates are strict", () => {
  it("takes an image key, not a client-supplied URL", () => {
    const key = "products/2026/0f8fad5b-d9cb-469f-a165-70867728950e.webp";
    expect(AdminImageInput.parse({ key, alt: "Skillet", position: 0 })).not.toHaveProperty("url");
    const traversal = { key: "../../etc/passwd", alt: "", position: 0 };
    expect(AdminImageInput.safeParse(traversal).success).toBe(false);
  });

  it("rejects non-http(s) download URLs", () => {
    const job = {
      id: "r1",
      type: "orders",
      format: "csv",
      status: "done",
      range: { from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" },
      rowCount: 3,
      error: null,
      downloadExpiresAt: "2026-10-10T00:05:00Z",
      requestedByEmail: "admin@example.test",
      createdAt: "2026-10-10T00:00:00Z",
      completedAt: "2026-10-10T00:00:01Z",
    };
    expect(ReportJob.safeParse({ ...job, downloadUrl: "javascript:alert(1)" }).success).toBe(false);
    const https = { ...job, downloadUrl: "https://cdn.example.test/r.csv" };
    expect(ReportJob.safeParse(https).success).toBe(true);
  });

  it.each([
    { from: "10", to: "2026-01-02" },
    { from: ["2026-01-01"], to: "2026-01-02" },
    { from: "2026-02-30", to: "2026-03-01" },
  ])("rejects non-ISO date input %o", (range) => {
    expect(AnalyticsRange.safeParse(range).success).toBe(false);
  });

  it("accepts date-only and full ISO timestamps as UTC", () => {
    const r = AnalyticsRange.parse({ from: "2026-09-01", to: "2026-09-02T12:00:00Z" });
    expect(r.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("checks from <= to on the admin order list", () => {
    const result = AdminOrderQuery.safeParse({ from: "2026-09-02", to: "2026-09-01" });
    expect(result.success).toBe(false);
  });

  it("validates coupon dates the same way", () => {
    const coupon = { code: "SPRING", type: "FIXED", value: 100, startsAt: "soon" };
    expect(CouponInput.safeParse(coupon).success).toBe(false);
  });
});

describe("[LOW] smaller tightenings", () => {
  const address = {
    fullName: "Ada",
    line1: "Al Khuwair",
    city: "Bawshar",
    region: "MA",
    country: "OM",
  };

  it("requires an 8-digit Omani phone number", () => {
    expect(ShippingAddress.safeParse({ ...address, phone: "-------" }).success).toBe(false);
    expect(ShippingAddress.safeParse({ ...address, phone: "+1 (415) 555-0100" }).success).toBe(
      false,
    );
    expect(ShippingAddress.safeParse({ ...address, phone: "+968 (9123) 4567" }).success).toBe(true);
  });

  it("checks a cart line total against price × quantity", () => {
    const line = {
      id: "l1",
      variantId: "v1",
      productSlug: "skillet",
      productName: "Skillet",
      variantName: "10 in",
      sku: "IV-SK10",
      thumbnailUrl: null,
      unitPriceCents: 1000,
      quantity: 2,
      lineTotalCents: 1500,
      stockAvailable: 5,
    };
    expect(CartLine.safeParse(line).success).toBe(false);

    const fixed = { ...line, lineTotalCents: 2000 };
    const totals = {
      subtotalCents: 1999,
      discountCents: 0,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 1999,
    };
    expect(Cart.safeParse({ id: "c", couponCode: null, items: [fixed], totals }).success).toBe(
      false,
    );
  });

  it("checks an order's summary total and item count against its lines", () => {
    const order = {
      id: "o1",
      number: "HP-2026-000001",
      status: "PAID",
      totalCents: 999,
      itemCount: 1,
      createdAt: "2026-10-01T00:00:00Z",
      currency: "OMR",
      paymentMethod: "card",
      paymentLabel: null,
      paymentDueAt: null,
      bankTransfer: null,
      manualPayment: null,
      email: "a@example.test",
      items: [
        {
          id: "i1",
          variantId: "v1",
          productName: "P",
          variantName: "V",
          sku: "S-1",
          unitPriceCents: 1000,
          quantity: 1,
          lineTotalCents: 1000,
        },
      ],
      totals: {
        subtotalCents: 1000,
        discountCents: 0,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
      },
      refundedCents: 0,
      refundState: "NONE",
      shippingAddress: address,
      shippingMethod: "standard",
      trackingNumber: null,
      carrier: null,
      estimatedDeliveryAt: null,
      couponCode: null,
      paidAt: null,
      events: [],
    };
    expect(OrderDetail.safeParse(order).success).toBe(false);
    expect(OrderDetail.safeParse({ ...order, totalCents: 1000 }).success).toBe(true);
    expect(OrderDetail.safeParse({ ...order, totalCents: 1000, itemCount: 3 }).success).toBe(false);
    const overRefunded = { ...order, totalCents: 1000, refundedCents: 1200, refundState: "FULL" };
    expect(OrderDetail.safeParse(overRefunded).success).toBe(false);
  });

  it("supports server-side sorting of the admin products table", () => {
    expect(AdminProductQuery.parse({})).toMatchObject({ sort: "updatedAt", dir: "desc" });
    expect(AdminProductQuery.parse({ sort: "price", dir: "asc" })).toMatchObject({
      sort: "price",
      dir: "asc",
    });
    expect(AdminProductQuery.safeParse({ sort: "cost" }).success).toBe(false);
  });

  it("parses lowStock like other query booleans", () => {
    expect(AdminProductQuery.parse({ lowStock: "1" }).lowStock).toBe(true);
  });

  it("limits coupon category restrictions", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${i}`);
    const coupon = { code: "SPRING", type: "FIXED", value: 100, categoryIds: ids };
    expect(CouponInput.safeParse(coupon).success).toBe(false);
  });

  it("looks up guest orders from a request body, not the query string", () => {
    const input = { number: "HP-2026-000001", token: "t".repeat(32) };
    expect(GuestOrderLookupInput.safeParse(input).success).toBe(true);
  });
});

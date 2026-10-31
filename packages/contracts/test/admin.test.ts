import { describe, expect, it } from "vitest";
import {
  AdminProductInput,
  AdminProductListItem,
  AnalyticsRange,
  CouponInput,
  InventoryAdjustInput,
  OrderStatusUpdate,
  PresignInput,
  RefundInput,
} from "../src/admin";

const variant = {
  sku: "LDG-SK10",
  name: "10 inch",
  priceCents: 3499,
  compareAtPriceCents: null,
  costCents: 1800,
  initialStock: 20,
  lowStockThreshold: 5,
  attributes: { size: "10in" },
};

const product = {
  name: 'Cast Iron Skillet 10"',
  slug: "cast-iron-skillet-10in",
  categoryId: "c1",
  description: "<p>Pre-seasoned.</p>",
  variants: [variant],
};

describe("AdminProductInput", () => {
  it("accepts a valid product and defaults it to DRAFT", () => {
    expect(AdminProductInput.parse(product).status).toBe("DRAFT");
  });

  it("requires at least one variant", () => {
    expect(AdminProductInput.safeParse({ ...product, variants: [] }).success).toBe(false);
  });

  it("rejects duplicate SKUs", () => {
    const result = AdminProductInput.safeParse({ ...product, variants: [variant, { ...variant }] });
    expect(result.success).toBe(false);
  });

  it("requires compare-at price to be higher than the price", () => {
    const result = AdminProductInput.safeParse({
      ...product,
      variants: [{ ...variant, compareAtPriceCents: 3000 }],
    });
    expect(result.success).toBe(false);
  });

  it("caps oven-safe temperature at a plausible value", () => {
    expect(AdminProductInput.safeParse({ ...product, ovenSafeToF: 2000 }).success).toBe(false);
  });
});

describe("AdminProductListItem", () => {
  it("parses an admin table row", () => {
    const row = AdminProductListItem.parse({
      id: "p1",
      slug: "cast-iron-skillet-10in",
      name: 'Cast Iron Skillet 10"',
      status: "ACTIVE",
      categoryName: "Skillets",
      thumbnailUrl: null,
      variantCount: 2,
      fromPriceCents: 3499,
      stockAvailable: 32,
      lowStock: false,
      updatedAt: "2026-10-10T09:00:00Z",
    });
    expect(row.status).toBe("ACTIVE");
  });
});

describe("CouponInput", () => {
  const base = { code: " spring10 ", type: "PERCENT", value: 10 } as const;

  it("normalizes the code to trimmed upper case", () => {
    expect(CouponInput.parse(base).code).toBe("SPRING10");
  });

  it.each([0, 101])("rejects a percent value of %s", (value) => {
    expect(CouponInput.safeParse({ ...base, value }).success).toBe(false);
  });

  it("requires a positive amount for FIXED coupons", () => {
    expect(CouponInput.safeParse({ ...base, type: "FIXED", value: 0 }).success).toBe(false);
    expect(CouponInput.safeParse({ ...base, type: "FIXED", value: 500 }).success).toBe(true);
  });

  it("requires a zero value for FREE_SHIPPING coupons", () => {
    expect(CouponInput.safeParse({ ...base, type: "FREE_SHIPPING", value: 5 }).success).toBe(false);
    expect(CouponInput.safeParse({ ...base, type: "FREE_SHIPPING", value: 0 }).success).toBe(true);
  });

  it("requires the end date to be after the start date", () => {
    const result = CouponInput.safeParse({
      ...base,
      startsAt: "2026-12-01T00:00:00Z",
      endsAt: "2026-11-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects codes with symbols", () => {
    expect(CouponInput.safeParse({ ...base, code: "SAVE$10" }).success).toBe(false);
  });
});

describe("InventoryAdjustInput", () => {
  it("accepts a restock", () => {
    expect(
      InventoryAdjustInput.safeParse({ variantId: "v1", delta: 24, reason: "RESTOCK" }).success,
    ).toBe(true);
  });

  it("rejects a zero delta", () => {
    expect(
      InventoryAdjustInput.safeParse({ variantId: "v1", delta: 0, reason: "CORRECTION" }).success,
    ).toBe(false);
  });

  it("does not allow manual SALE entries (only checkout writes those)", () => {
    expect(
      InventoryAdjustInput.safeParse({ variantId: "v1", delta: -1, reason: "SALE" }).success,
    ).toBe(false);
  });
});

describe("OrderStatusUpdate", () => {
  it("requires a tracking number when marking shipped", () => {
    expect(OrderStatusUpdate.safeParse({ status: "SHIPPED" }).success).toBe(false);
    expect(
      OrderStatusUpdate.safeParse({ status: "SHIPPED", trackingNumber: "1Z999" }).success,
    ).toBe(true);
    const withDelivery = {
      status: "SHIPPED",
      trackingNumber: "1Z999",
      carrier: "Aramex",
      expectedDeliveryDate: "2026-10-28",
    };
    expect(OrderStatusUpdate.safeParse(withDelivery).success).toBe(true);
    expect(
      OrderStatusUpdate.safeParse({ ...withDelivery, expectedDeliveryDate: "28/10/2026" }).success,
    ).toBe(false);
  });

  it.each(["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "PAID"])(
    "routes %s through its dedicated action instead",
    (status) => {
      expect(OrderStatusUpdate.safeParse({ status }).success).toBe(false);
    },
  );
});

describe("RefundInput", () => {
  it.each([0, -100, 10.5])("rejects amount %s", (amountCents) => {
    expect(RefundInput.safeParse({ amountCents }).success).toBe(false);
  });
});

describe("AnalyticsRange", () => {
  it("coerces dates and defaults the interval to day", () => {
    const range = AnalyticsRange.parse({ from: "2026-09-01", to: "2026-09-30" });
    expect(range.interval).toBe("day");
    expect(range.from).toBeInstanceOf(Date);
  });

  it("rejects a range that ends before it starts", () => {
    expect(AnalyticsRange.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success).toBe(false);
  });

  it("rejects ranges longer than 366 days", () => {
    expect(AnalyticsRange.safeParse({ from: "2024-01-01", to: "2026-01-01" }).success).toBe(false);
  });
});

describe("PresignInput", () => {
  it("accepts a WebP under 8 MB", () => {
    expect(
      PresignInput.safeParse({ contentType: "image/webp", contentLength: 500_000 }).success,
    ).toBe(true);
  });

  it("rejects SVG (script-capable) uploads", () => {
    expect(
      PresignInput.safeParse({ contentType: "image/svg+xml", contentLength: 1000 }).success,
    ).toBe(false);
  });

  it("rejects files over 8 MB", () => {
    expect(
      PresignInput.safeParse({ contentType: "image/png", contentLength: 9 * 1024 * 1024 }).success,
    ).toBe(false);
  });
});

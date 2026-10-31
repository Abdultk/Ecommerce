import { describe, expect, it } from "vitest";
import { computeTotals } from "./pricing";

const pan = { unitPriceCents: 4_999, quantity: 1, categoryId: "cookware" };
const knife = { unitPriceCents: 8_900, quantity: 1, categoryId: "knives" };

describe("computeTotals", () => {
  it("returns zeros for an empty cart", () => {
    expect(computeTotals([], 799, 825)).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      shippingCents: 799,
      taxCents: 0,
      totalCents: 799,
    });
  });

  it("adds the shipping quote it is given", () => {
    expect(computeTotals([pan], 799, 0)).toMatchObject({
      subtotalCents: 4_999,
      shippingCents: 799,
      totalCents: 5_798,
    });
  });

  it("leaves free-shipping thresholds to the shipping quote", () => {
    // Thresholds depend on the shipping method, so shipping.ts applies them before this.
    const line = { ...pan, unitPriceCents: 20_000 };
    expect(computeTotals([line], 1_999, 0).shippingCents).toBe(1_999);
  });

  it("multiplies by quantity", () => {
    expect(computeTotals([{ ...pan, quantity: 3 }], 0, 0).subtotalCents).toBe(14_997);
  });

  it("applies a percent coupon only to eligible categories, rounding down", () => {
    const coupon = {
      type: "PERCENT" as const,
      value: 15,
      minSubtotalCents: 0,
      categoryIds: ["knives"],
    };
    expect(computeTotals([pan, knife], 0, 0, coupon).discountCents).toBe(1_335); // 15% of 8900 = 1335
  });

  it("applies a percent coupon to everything when unrestricted", () => {
    const coupon = { type: "PERCENT" as const, value: 10, minSubtotalCents: 0, categoryIds: [] };
    expect(computeTotals([pan, knife], 0, 0, coupon).discountCents).toBe(1_389);
  });

  it("caps a fixed coupon at the eligible subtotal", () => {
    const coupon = { type: "FIXED" as const, value: 10_000, minSubtotalCents: 0, categoryIds: [] };
    expect(computeTotals([pan], 0, 0, coupon).discountCents).toBe(4_999);
  });

  it("ignores a coupon when the minimum subtotal isn't met", () => {
    const coupon = {
      type: "PERCENT" as const,
      value: 20,
      minSubtotalCents: 10_000,
      categoryIds: [],
    };
    expect(computeTotals([pan], 0, 0, coupon).discountCents).toBe(0);
  });

  it("free-shipping coupons zero the shipping only", () => {
    const coupon = {
      type: "FREE_SHIPPING" as const,
      value: 0,
      minSubtotalCents: 0,
      categoryIds: [],
    };
    expect(computeTotals([pan], 799, 0, coupon)).toMatchObject({
      shippingCents: 0,
      discountCents: 0,
    });
  });

  it("taxes the discounted subtotal and keeps the totals invariant", () => {
    const coupon = { type: "FIXED" as const, value: 1_000, minSubtotalCents: 0, categoryIds: [] };
    const t = computeTotals([pan], 799, 825, coupon); // 8.25%
    expect(t.taxCents).toBe(330); // round(3999 * 0.0825)
    expect(t.totalCents).toBe(t.subtotalCents - t.discountCents + t.shippingCents + t.taxCents);
  });

  it("rejects invalid inputs instead of producing a wrong total", () => {
    expect(() => computeTotals([{ ...pan, quantity: 0 }], 0, 0)).toThrow(RangeError);
    expect(() => computeTotals([{ ...pan, unitPriceCents: 1.5 }], 0, 0)).toThrow(RangeError);
    expect(() => computeTotals([pan], -1, 0)).toThrow(RangeError);
    expect(() => computeTotals([pan], 0, -5)).toThrow(RangeError);
  });
});

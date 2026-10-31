import { formatMoney } from "@hp/contracts";
import { describe, expect, it } from "vitest";
import { GENERIC_COUPON_MESSAGE, evaluateCoupon, type CouponRecord } from "./coupons";

const NOW = new Date("2026-10-10T12:00:00Z");

const coupon = (overrides: Partial<CouponRecord> = {}): CouponRecord => ({
  code: "WELCOME10",
  type: "PERCENT",
  value: 10,
  minSubtotalCents: 0,
  maxRedemptions: null,
  perCustomerLimit: 1,
  redemptions: 0,
  startsAt: null,
  endsAt: null,
  isActive: true,
  categoryIds: [],
  ...overrides,
});

const lines = [
  { unitPriceCents: 4_000, quantity: 1, categoryId: "cookware" },
  { unitPriceCents: 2_000, quantity: 1, categoryId: "storage" },
];

const ctx = (overrides = {}) => ({
  lines,
  currency: "OMR" as const,
  now: NOW,
  customerRedemptions: 0,
  ...overrides,
});

describe("evaluateCoupon", () => {
  it("accepts a valid coupon and returns its pricing rule", () => {
    expect(evaluateCoupon(coupon(), ctx())).toEqual({
      ok: true,
      rule: { type: "PERCENT", value: 10, minSubtotalCents: 0, categoryIds: [] },
    });
  });

  it.each([
    ["missing", null, "That code isn't valid."],
    ["inactive", coupon({ isActive: false }), "That code isn't valid."],
    [
      "not started",
      coupon({ startsAt: new Date("2026-11-01T00:00:00Z") }),
      "That code isn't active yet.",
    ],
    ["expired", coupon({ endsAt: new Date("2026-10-01T00:00:00Z") }), "That code has expired."],
    [
      "fully redeemed",
      coupon({ maxRedemptions: 5, redemptions: 5 }),
      "That code has been fully redeemed.",
    ],
  ])("rejects a %s coupon", (_label, record, message) => {
    expect(evaluateCoupon(record, ctx())).toEqual({ ok: false, message });
  });

  it("enforces the per-customer limit when the customer is known", () => {
    expect(evaluateCoupon(coupon(), ctx({ customerRedemptions: 1 }))).toEqual({
      ok: false,
      message: "You've already used that code.",
    });
    expect(
      evaluateCoupon(coupon({ perCustomerLimit: null }), ctx({ customerRedemptions: 9 })).ok,
    ).toBe(true);
  });

  it("gives guests a generic answer that doesn't reveal earlier use by their email", () => {
    const guest = evaluateCoupon(coupon(), ctx({ customerRedemptions: 1, guest: true }));
    expect(guest).toEqual({ ok: false, message: GENERIC_COUPON_MESSAGE });
    expect(GENERIC_COUPON_MESSAGE).not.toMatch(/already|used/i);
  });

  it("tells the shopper how much more to spend", () => {
    expect(evaluateCoupon(coupon({ minSubtotalCents: 7_500 }), ctx())).toEqual({
      ok: false,
      message: `Spend ${formatMoney(1_500, "OMR")} more to use this code.`,
    });
  });

  it("rejects a category-restricted coupon when nothing in the cart qualifies", () => {
    expect(evaluateCoupon(coupon({ categoryIds: ["knives"] }), ctx())).toEqual({
      ok: false,
      message: "That code doesn't apply to the items in your cart.",
    });
    expect(evaluateCoupon(coupon({ categoryIds: ["storage"] }), ctx()).ok).toBe(true);
  });

  it("treats the end date as exclusive and the start date as inclusive", () => {
    expect(evaluateCoupon(coupon({ startsAt: NOW }), ctx()).ok).toBe(true);
    expect(evaluateCoupon(coupon({ endsAt: NOW }), ctx()).ok).toBe(false);
  });
});

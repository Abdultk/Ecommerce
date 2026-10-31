import { formatMoney, type CurrencyCode } from "@hp/contracts";
import type { CouponRule, PricedLine } from "./pricing";

/** The coupon fields the rules need (a subset of the Prisma Coupon row). */
export type CouponRecord = {
  code: string;
  type: CouponRule["type"];
  value: number;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  redemptions: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  categoryIds: string[];
};

export type CouponContext = {
  lines: readonly PricedLine[];
  /** The store currency, for the "spend X more" message. */
  currency: CurrencyCode;
  now: Date;
  /** Paid orders by this customer that used the code; 0 when the customer is unknown. */
  customerRedemptions: number;
  /**
   * Guest checkout counts redemptions by the typed email, so a specific "already used"
   * answer would reveal that someone with that email used the code. Guests get a generic one.
   */
  guest?: boolean;
};

export const GENERIC_COUPON_MESSAGE = "That code isn't available for this order.";

export type CouponEvaluation = { ok: true; rule: CouponRule } | { ok: false; message: string };

/** Pure eligibility check with shopper-facing messages. Checkout re-runs it before charging. */
export function evaluateCoupon(coupon: CouponRecord | null, ctx: CouponContext): CouponEvaluation {
  const reject = (message: string): CouponEvaluation => ({ ok: false, message });

  if (!coupon || !coupon.isActive) return reject("That code isn't valid.");
  if (coupon.startsAt && ctx.now < coupon.startsAt) return reject("That code isn't active yet.");
  if (coupon.endsAt && ctx.now >= coupon.endsAt) return reject("That code has expired.");
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) {
    return reject("That code has been fully redeemed.");
  }
  if (coupon.perCustomerLimit !== null && ctx.customerRedemptions >= coupon.perCustomerLimit) {
    return reject(ctx.guest ? GENERIC_COUPON_MESSAGE : "You've already used that code.");
  }

  const subtotal = ctx.lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  if (subtotal < coupon.minSubtotalCents) {
    return reject(
      `Spend ${formatMoney(coupon.minSubtotalCents - subtotal, ctx.currency)} more to use this code.`,
    );
  }
  if (
    coupon.categoryIds.length > 0 &&
    !ctx.lines.some((l) => coupon.categoryIds.includes(l.categoryId))
  ) {
    return reject("That code doesn't apply to the items in your cart.");
  }

  return {
    ok: true,
    rule: {
      type: coupon.type,
      value: coupon.value,
      minSubtotalCents: coupon.minSubtotalCents,
      categoryIds: coupon.categoryIds,
    },
  };
}

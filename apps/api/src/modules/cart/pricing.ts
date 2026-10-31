import type { Totals } from "@hp/contracts";

export type PricedLine = { unitPriceCents: number; quantity: number; categoryId: string };

export type CouponRule = {
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotalCents: number;
  categoryIds: readonly string[];
};

const BASIS_POINTS = 10_000;
const PERCENT = 100;

const lineTotal = (l: PricedLine) => l.unitPriceCents * l.quantity;
const isCents = (n: number) => Number.isInteger(n) && n >= 0;

function assertValid(lines: readonly PricedLine[], shippingQuoteCents: number, taxRateBps: number) {
  for (const l of lines) {
    if (!isCents(l.unitPriceCents) || !Number.isInteger(l.quantity) || l.quantity < 1) {
      throw new RangeError(`Invalid cart line: ${JSON.stringify(l)}`);
    }
  }
  if (!isCents(shippingQuoteCents)) throw new RangeError(`Invalid shipping: ${shippingQuoteCents}`);
  if (!isCents(taxRateBps)) throw new RangeError(`Invalid tax rate: ${taxRateBps}`);
}

/**
 * The only place totals are computed. Pure and integer-only so it can be unit-tested
 * exhaustively and reused unchanged by cart display and checkout.
 */
export function computeTotals(
  lines: readonly PricedLine[],
  shippingQuoteCents: number,
  taxRateBps: number,
  coupon?: CouponRule,
): Totals {
  assertValid(lines, shippingQuoteCents, taxRateBps);

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const qualifies = coupon !== undefined && subtotal >= coupon.minSubtotalCents;

  const eligible =
    qualifies && coupon.categoryIds.length > 0
      ? lines
          .filter((l) => coupon.categoryIds.includes(l.categoryId))
          .reduce((s, l) => s + lineTotal(l), 0)
      : subtotal;

  const discount = !qualifies
    ? 0
    : coupon.type === "PERCENT"
      ? Math.floor((eligible * coupon.value) / PERCENT)
      : coupon.type === "FIXED"
        ? Math.min(coupon.value, eligible)
        : 0;

  // Method-specific free-shipping thresholds are already applied by the shipping quote;
  // here only a FREE_SHIPPING coupon can zero it.
  const shipping = qualifies && coupon.type === "FREE_SHIPPING" ? 0 : shippingQuoteCents;
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * taxRateBps) / BASIS_POINTS);

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: taxable + shipping + tax,
  };
}

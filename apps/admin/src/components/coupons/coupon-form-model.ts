import {
  CouponInput,
  formatMoney,
  type CouponType,
  type CouponView,
  type CurrencyCode,
} from "@hp/contracts";
import type { z } from "zod";
import { toInt } from "@/lib/format";
import { minorToInput, parseMoneyInput } from "@/lib/money";

export type CouponKind = z.infer<typeof CouponType>;

export type CouponFormValues = {
  code: string;
  type: CouponKind;
  /** Percent for PERCENT, a store-currency amount for FIXED, ignored for FREE_SHIPPING */
  value: string;
  minSubtotal: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  /** YYYY-MM-DD or "" */
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  categoryIds: string[];
};

/** The JSON body for POST and PATCH (PATCH takes the full form). Dates stay YYYY-MM-DD. */
export type CouponBody = {
  code: string;
  type: CouponKind;
  value: number;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
  categoryIds: string[];
};

export const emptyCoupon = (): CouponFormValues => ({
  code: "",
  type: "PERCENT",
  value: "",
  minSubtotal: "",
  maxRedemptions: "",
  perCustomerLimit: "1",
  startsAt: "",
  endsAt: "",
  isActive: true,
  categoryIds: [],
});

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function couponFormFrom(c: CouponView, currency: CurrencyCode): CouponFormValues {
  return {
    code: c.code,
    type: c.type,
    value:
      c.type === "FIXED"
        ? minorToInput(c.value, currency)
        : c.type === "PERCENT"
          ? String(c.value)
          : "",
    minSubtotal: c.minSubtotalCents > 0 ? minorToInput(c.minSubtotalCents, currency) : "",
    maxRedemptions: c.maxRedemptions === null ? "" : String(c.maxRedemptions),
    perCustomerLimit: c.perCustomerLimit === null ? "" : String(c.perCustomerLimit),
    startsAt: dateOnly(c.startsAt),
    endsAt: dateOnly(c.endsAt),
    isActive: c.isActive,
    categoryIds: c.categoryIds,
  };
}

function valueFor(form: CouponFormValues, currency: CurrencyCode): number {
  if (form.type === "FREE_SHIPPING") return 0;
  const parsed = form.type === "FIXED" ? parseMoneyInput(form.value, currency) : toInt(form.value);
  return parsed ?? Number.NaN;
}

export function couponBody(form: CouponFormValues, currency: CurrencyCode): CouponBody {
  return {
    code: form.code.trim().toUpperCase(),
    type: form.type,
    value: valueFor(form, currency),
    minSubtotalCents: parseMoneyInput(form.minSubtotal, currency) ?? 0,
    maxRedemptions: toInt(form.maxRedemptions),
    perCustomerLimit: toInt(form.perCustomerLimit),
    ...(form.startsAt && { startsAt: form.startsAt }),
    ...(form.endsAt && { endsAt: form.endsAt }),
    isActive: form.isActive,
    categoryIds: form.categoryIds,
  };
}

const FRIENDLY_TYPE_ERRORS: Record<string, string> = {
  value: "Enter a number.",
  minSubtotalCents: "Enter an amount like 30.000.",
  maxRedemptions: "Enter a whole number, or leave it blank for no limit.",
  perCustomerLimit: "Enter a whole number, or leave it blank for no limit.",
};

/** Validates with CouponInput; errors are keyed by the body field name. */
export function validateCoupon(
  form: CouponFormValues,
  currency: CurrencyCode,
): {
  body: CouponBody;
  errors: Record<string, string>;
} {
  const body = couponBody(form, currency);
  const parsed = CouponInput.safeParse(body);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??=
        issue.code === "invalid_type"
          ? (FRIENDLY_TYPE_ERRORS[key] ?? issue.message)
          : issue.message;
    });
  }
  return { body, errors };
}

/** "10% off", "OMR 5.000 off", "Free shipping" */
export function describeCoupon(
  c: Pick<CouponView, "type" | "value">,
  currency: CurrencyCode,
): string {
  if (c.type === "PERCENT") return `${c.value}% off`;
  if (c.type === "FIXED") return `${formatMoney(c.value, currency)} off`;
  return "Free shipping";
}

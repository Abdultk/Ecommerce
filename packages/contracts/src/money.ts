import { z } from "zod";

/** ISO 4217 codes the store can be set to. Order matters only for display in pickers. */
export const CURRENCY_CODES = [
  "OMR",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "USD",
  "EUR",
  "GBP",
] as const;

export const CurrencyCode = z.enum(CURRENCY_CODES);
export type CurrencyCode = z.infer<typeof CurrencyCode>;

export type CurrencyInfo = { readonly exponent: number; readonly name: string };

/**
 * Minor-unit exponents from ISO 4217: every `*Cents` amount is an integer count of
 * 10^-exponent of the currency (1 OMR = 1000 baisa, 1 USD = 100 cents).
 */
export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyInfo>> = Object.freeze({
  OMR: Object.freeze({ exponent: 3, name: "Omani rial" }),
  AED: Object.freeze({ exponent: 2, name: "UAE dirham" }),
  SAR: Object.freeze({ exponent: 2, name: "Saudi riyal" }),
  QAR: Object.freeze({ exponent: 2, name: "Qatari riyal" }),
  KWD: Object.freeze({ exponent: 3, name: "Kuwaiti dinar" }),
  BHD: Object.freeze({ exponent: 3, name: "Bahraini dinar" }),
  USD: Object.freeze({ exponent: 2, name: "US dollar" }),
  EUR: Object.freeze({ exponent: 2, name: "Euro" }),
  GBP: Object.freeze({ exponent: 2, name: "Pound sterling" }),
});

export const DEFAULT_LOCALE = "en-OM";

export function currencyExponent(code: CurrencyCode): number {
  return CURRENCIES[code].exponent;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/**
 * Formats integer minor units for display, always with exactly the currency's
 * decimals: formatMoney(18500, "OMR") → "OMR 18.500" (the symbol depends on the locale).
 */
export function formatMoney(minor: number, code: CurrencyCode, locale = DEFAULT_LOCALE): string {
  assertSafeInteger(minor, "Amount");
  const exponent = currencyExponent(code);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

/**
 * Converts an amount between minor-unit scales of two currencies (a store currency
 * switch: the number of major units stays the same, no exchange rate is applied).
 * Losing decimals rounds half up (half away from zero for negative amounts).
 */
export function rescaleMinor(amount: number, from: CurrencyCode, to: CurrencyCode): number {
  assertSafeInteger(amount, "Amount");
  const delta = currencyExponent(to) - currencyExponent(from);
  if (delta >= 0) {
    const result = amount * 10 ** delta;
    assertSafeInteger(result, "Rescaled amount");
    return result;
  }
  const factor = 10 ** -delta;
  const magnitude = Math.floor((Math.abs(amount) + factor / 2) / factor);
  // 0 - x (not -x) so a tiny negative amount rounds to +0, never -0.
  return amount < 0 ? 0 - magnitude : magnitude;
}

import { DEFAULT_LOCALE, currencyExponent, type CurrencyCode } from "@hp/contracts";

// Money input and display helpers. Amounts are always integer minor units of a currency
// (baisa for OMR, cents for USD). Inputs are parsed as decimal strings, never as floats,
// so "1.005" OMR is exactly 1005 baisa. Display goes through formatMoney from @hp/contracts.

const MAX_WHOLE_DIGITS = 9;
const MAX_PERCENT_DECIMALS = 2;
const BPS_PER_PERCENT = 100;

/** "12.5" with up to `exponent` decimals; no sign, exponent notation or bare ".5". */
function decimalPattern(exponent: number): RegExp {
  const fraction = exponent > 0 ? `(\\.\\d{1,${exponent}})?` : "";
  return new RegExp(`^\\d{1,${MAX_WHOLE_DIGITS}}${fraction}$`);
}

/** Integer arithmetic only: "18.5" with exponent 3 → 18 * 1000 + 500. */
function decimalToScaled(text: string, exponent: number): number {
  const [whole = "0", fraction = ""] = text.split(".");
  const scaled = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(scaled) ? scaled : Number.NaN;
}

/**
 * A money field's text → integer minor units of `currency`. Blank → null. Anything that is
 * not a plain amount with at most the currency's decimals → NaN, which the contract schemas
 * reject, so forms show a field error instead of guessing.
 */
export function parseMoneyInput(input: string, currency: CurrencyCode): number | null {
  const trimmed = input
    .trim()
    .replace(new RegExp(`^${currency}\\s*`, "i"), "")
    .replace(/,/g, "");
  if (trimmed === "") return null;
  const exponent = currencyExponent(currency);
  if (!decimalPattern(exponent).test(trimmed)) return Number.NaN;
  return decimalToScaled(trimmed, exponent);
}

/** 18500 baisa → "18.500" for a money field's value; null/undefined → "". */
export function minorToInput(minor: number | null | undefined, currency: CurrencyCode): string {
  if (minor === null || minor === undefined) return "";
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** 1234500 baisa → "OMR 1.2K" for chart axes. */
export function formatCompactMoney(
  minor: number,
  currency: CurrencyCode,
  locale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(minor / 10 ** currencyExponent(currency));
}

/** "Price" → "Price (OMR)": money fields always name their currency. */
export function moneyLabel(label: string, currency: CurrencyCode): string {
  return `${label} (${currency})`;
}

/** A VAT field's "5.25" (%) → 525 basis points. Blank → null, junk → NaN. */
export function parsePercentToBps(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!decimalPattern(MAX_PERCENT_DECIMALS).test(trimmed)) return Number.NaN;
  return decimalToScaled(trimmed, MAX_PERCENT_DECIMALS);
}

/** 525 bps → "5.25", 500 → "5". */
export function bpsToPercentInput(bps: number): string {
  const whole = Math.trunc(bps / BPS_PER_PERCENT);
  const fraction = String(bps % BPS_PER_PERCENT)
    .padStart(MAX_PERCENT_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

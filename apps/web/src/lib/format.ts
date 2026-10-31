import { MAX_CENTS, currencyExponent, type CurrencyCode } from "@hp/contracts";

// Money is displayed with `formatMoney` from @hp/contracts (exponent-aware: OMR has three
// decimals). These helpers cover the rest: typed price inputs, discounts, ratings, dates.

/** Whole-number percentage saved, or null when the compare-at price is not a real discount. */
export function discountPercent(priceCents: number, compareAtCents: number | null): number | null {
  if (compareAtCents === null || compareAtCents <= priceCents) return null;
  return Math.round(((compareAtCents - priceCents) / compareAtCents) * 100);
}

/**
 * A typed amount in major units ("18.5" OMR) as minor units (18500): undefined when blank,
 * "invalid" when malformed, more precise than the currency allows, or out of range.
 */
export function parseMajorAmount(raw: string, code: CurrencyCode): number | undefined | "invalid" {
  const value = raw.trim();
  if (value === "") return undefined;
  const exponent = currencyExponent(code);
  if (!new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`).test(value)) return "invalid";
  const minor = Math.round(Number(value) * 10 ** exponent);
  return minor > MAX_CENTS ? "invalid" : minor;
}

/** Minor units as a plain major-unit number for an input field ("" when unset). */
export function minorToMajorInput(minor: number | undefined, code: CurrencyCode): string {
  return minor === undefined ? "" : String(minor / 10 ** currencyExponent(code));
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** The shop is in Oman: payment deadlines are shown in Muscat time, zone named. */
export const STORE_TIME_ZONE = "Asia/Muscat";
const dueFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: STORE_TIME_ZONE,
  timeZoneName: "short",
});

const localizedFormatters = new Map<string, Intl.DateTimeFormat>();

function localizedFormatter(
  kind: "date" | "dateTime" | "due",
  locale: string,
): Intl.DateTimeFormat {
  const key = `${kind}:${locale}`;
  let formatter = localizedFormatters.get(key);
  if (!formatter) {
    const options: Record<typeof kind, Intl.DateTimeFormatOptions> = {
      date: { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
      dateTime: {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      },
      due: {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: STORE_TIME_ZONE,
        timeZoneName: "short",
      },
    };
    formatter = new Intl.DateTimeFormat(locale, options[kind]);
    localizedFormatters.set(key, formatter);
  }
  return formatter;
}

/** The same three formats as below, in any Intl locale (e.g. `intlLocale("ar")`). */
export const formatDateIn = (iso: string, locale: string): string =>
  localizedFormatter("date", locale).format(new Date(iso));
export const formatDateTimeIn = (iso: string, locale: string): string =>
  localizedFormatter("dateTime", locale).format(new Date(iso));
export const formatDueDateTimeIn = (iso: string, locale: string): string =>
  localizedFormatter("due", locale).format(new Date(iso));

/** "Oct 8, 2026" — UTC so server and client render the same text. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** "Tue, Oct 13, 1:00 PM GMT+4": a deadline the customer acts on. */
export function formatDueDateTime(iso: string): string {
  return dueFormat.format(new Date(iso));
}

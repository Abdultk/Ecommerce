import type { Interval } from "@/lib/analytics-range";

// Labels for chart buckets and axes. Buckets are UTC, like the API's date_trunc.

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
// Money axes use formatCompactMoney (src/lib/money.ts) with the store currency.

export function formatBucket(iso: string, interval: Interval): string {
  const date = new Date(iso);
  if (interval === "month") return month.format(date);
  if (interval === "week") return `Week of ${day.format(date)}`;
  return day.format(date);
}

export const PERIOD_NOUNS: Record<Interval, string> = {
  day: "days",
  week: "weeks",
  month: "months",
};

export const formatCompactCount = (n: number): string => compact.format(n);

import type {
  AnalyticsSummary,
  CategorySales,
  CurrencyCode,
  SalesPoint,
  TopProduct,
} from "@hp/contracts";
import type { Interval } from "@/lib/analytics-range";
import type { MockDb } from "./types";

// Deterministic synthetic sales for the analytics mock: every UTC day has a fixed number of
// orders and revenue, so summaries, series and the previous period always agree and tests
// can rely on exact values for any range.

const DAY_MS = 86_400_000;
const MARGIN = 0.41;
const NEW_CUSTOMER_SHARE = 0.38;
const REFUND_EVERY = 25;

export type DaySpan = Readonly<{ first: number; last: number }>;

/** Whole UTC day numbers (days since 1970-01-01) covered by a range. */
export const daySpan = (from: Date, to: Date): DaySpan => ({
  first: Math.floor(from.getTime() / DAY_MS),
  last: Math.floor(to.getTime() / DAY_MS),
});

const weekdayFromMonday = (day: number) => (day + 3) % 7; // 1970-01-01 was a Thursday

function daily(day: number): { orders: number; revenueCents: number } {
  const weekend = weekdayFromMonday(day) >= 5 ? 4 : 0;
  const orders = 6 + ((day * 37) % 11) + weekend;
  const aovCents = 6_400 + ((day * 131) % 2_600);
  return { orders, revenueCents: orders * aovCents };
}

const daysOf = ({ first, last }: DaySpan): number[] =>
  Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);

function bucketStart(day: number, interval: Interval): number {
  if (interval === "day") return day;
  if (interval === "week") return day - weekdayFromMonday(day);
  const date = new Date(day * DAY_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS;
}

const aov = (revenueCents: number, orders: number) =>
  orders > 0 ? Math.round(revenueCents / orders) : 0;

export function salesSeries(span: DaySpan, interval: Interval): SalesPoint[] {
  const buckets = daysOf(span).reduce<
    ReadonlyMap<number, { orders: number; revenueCents: number }>
  >((acc, day) => {
    const key = bucketStart(day, interval);
    const prev = acc.get(key) ?? { orders: 0, revenueCents: 0 };
    const today = daily(day);
    return new Map(acc).set(key, {
      orders: prev.orders + today.orders,
      revenueCents: prev.revenueCents + today.revenueCents,
    });
  }, new Map());
  return [...buckets.entries()].map(([key, b]) => ({
    bucket: new Date(key * DAY_MS).toISOString(),
    orders: b.orders,
    revenueCents: b.revenueCents,
    aovCents: aov(b.revenueCents, b.orders),
  }));
}

function kpis(span: DaySpan, lowStockSkus: number): AnalyticsSummary["current"] {
  const totals = daysOf(span)
    .map(daily)
    .reduce(
      (a, d) => ({ orders: a.orders + d.orders, revenueCents: a.revenueCents + d.revenueCents }),
      {
        orders: 0,
        revenueCents: 0,
      },
    );
  const newCustomers = Math.round(totals.orders * NEW_CUSTOMER_SHARE);
  return {
    revenueCents: totals.revenueCents,
    orders: totals.orders,
    aovCents: aov(totals.revenueCents, totals.orders),
    refundRate: totals.orders > 0 ? Math.floor(totals.orders / REFUND_EVERY) / totals.orders : 0,
    newCustomers,
    returningCustomers: totals.orders - newCustomers,
    grossMarginCents: Math.round(totals.revenueCents * MARGIN),
    lowStockSkus,
  };
}

/** The current range and the same number of days immediately before it. */
export function summaryFor(
  span: DaySpan,
  lowStockSkus: number,
  currency: CurrencyCode = "OMR",
): AnalyticsSummary {
  const length = span.last - span.first + 1;
  const previous = { first: span.first - length, last: span.first - 1 };
  return {
    current: kpis(span, lowStockSkus),
    previous: kpis(previous, lowStockSkus),
    currency,
  };
}

type ProductSales = TopProduct & { categoryId: string };

function productSales(db: MockDb, span: DaySpan): ProductSales[] {
  const days = span.last - span.first + 1;
  return db.products
    .filter((p) => p.status === "ACTIVE" && p.variants.length > 0)
    .map((p, i) => {
      const unitsSold = days * (1 + ((i * 7) % 9));
      return {
        productId: p.id,
        name: p.name,
        unitsSold,
        revenueCents: unitsSold * (p.variants[0]?.priceCents ?? 0),
        categoryId: p.categoryId,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
}

export function topProducts(
  db: MockDb,
  span: DaySpan,
  limit: number,
  by: "revenue" | "units" = "revenue",
): TopProduct[] {
  const rank = (p: TopProduct) => (by === "units" ? p.unitsSold : p.revenueCents);
  return [...productSales(db, span)]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, limit)
    .map(({ productId, name, unitsSold, revenueCents }) => ({
      productId,
      name,
      unitsSold,
      revenueCents,
    }));
}

export function salesByCategory(db: MockDb, span: DaySpan): CategorySales[] {
  const totals = productSales(db, span).reduce<ReadonlyMap<string, CategorySales>>((acc, p) => {
    const name = db.categories.find((c) => c.id === p.categoryId)?.name ?? "Uncategorized";
    const prev = acc.get(p.categoryId) ?? {
      categoryId: p.categoryId,
      name,
      orders: 0,
      unitsSold: 0,
      revenueCents: 0,
    };
    return new Map(acc).set(p.categoryId, {
      ...prev,
      orders: prev.orders + Math.ceil(p.unitsSold * 0.8),
      unitsSold: prev.unitsSold + p.unitsSold,
      revenueCents: prev.revenueCents + p.revenueCents,
    });
  }, new Map());
  return [...totals.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

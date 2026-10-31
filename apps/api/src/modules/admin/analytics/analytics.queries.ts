import { Prisma } from "@prisma/client";
import type {
  AnalyticsSummary,
  CategorySales,
  SalesPoint,
  TopProduct,
  TopProductsQuery,
} from "@hp/contracts";
import type { DbClient } from "../../../lib/prisma";

/*
 * Revenue rules (all analytics endpoints and the sales report):
 * - An order counts once it is paid: `paidAt` falls in [from, end) and its status is not
 *   PENDING_PAYMENT or CANCELLED. A cancelled paid order is fully refunded at cancellation,
 *   so it is left out entirely. A REFUNDED order still counts as an order (and a refund).
 * - revenueCents is NET: Σ(totalCents − refundedCents), attributed to the period the order
 *   was paid in (not the refund date). Shipping and tax are included, as charged.
 * - aovCents is GROSS: Σ totalCents / orders, rounded; 0 for no orders.
 * - refundRate = share of counted orders with any refund (0..1).
 * - Customers are distinct emails (case-insensitive). "Returning" means the email has a
 *   counted order paid before `from`; everyone else is new.
 * - grossMarginCents = Σ item line totals − Σ order discounts − Σ quantity × current
 *   costCents. Shipping, tax and refunds are not in it. It is null when any sold item's
 *   variant has no costCents (a partial margin would look precise and be wrong).
 * - Product and category revenue are GROSS item line totals (before order-level discounts
 *   and refunds), so they rank what sold rather than reconcile to net revenue.
 * - All buckets are UTC.
 */

export type ResolvedRange = { from: Date; end: Date };

/** Binds a Date as a UTC timestamp, matching how Prisma stores DateTime columns. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** The "counted order" rule for alias `o` (see the rules above). Fully parameterized. */
const counted = (r: ResolvedRange) =>
  Prisma.sql`o."paidAt" >= ${utc(r.from)} AND o."paidAt" < ${utc(r.end)}
    AND o."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED')`;

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

type Kpis = AnalyticsSummary["current"];

type TotalsRow = {
  orders: number;
  gross: bigint;
  refunded: bigint;
  discounts: bigint;
  refunded_orders: number;
  lines: bigint | null;
  cost: bigint | null;
  missing_cost: boolean | null;
};

async function periodTotals(db: DbClient, r: ResolvedRange): Promise<TotalsRow> {
  const [row] = await db.$queryRaw<TotalsRow[]>`
    WITH c AS (SELECT o.id, o."totalCents", o."refundedCents", o."discountCents"
               FROM "Order" o WHERE ${counted(r)}),
    items AS (
      SELECT SUM(i."lineTotalCents")::bigint AS lines,
             SUM(i."quantity" * v."costCents")::bigint AS cost,
             BOOL_OR(v.id IS NULL OR v."costCents" IS NULL) AS missing_cost
      FROM "OrderItem" i JOIN c ON c.id = i."orderId"
      LEFT JOIN "ProductVariant" v ON v.id = i."variantId")
    SELECT COUNT(*)::int AS orders,
           COALESCE(SUM(c."totalCents"), 0)::bigint AS gross,
           COALESCE(SUM(c."refundedCents"), 0)::bigint AS refunded,
           COALESCE(SUM(c."discountCents"), 0)::bigint AS discounts,
           (COUNT(*) FILTER (WHERE c."refundedCents" > 0))::int AS refunded_orders,
           (SELECT lines FROM items) AS lines,
           (SELECT cost FROM items) AS cost,
           (SELECT missing_cost FROM items) AS missing_cost
    FROM c`;
  return row!;
}

/**
 * New vs returning in one aggregate: each period customer's first counted payment ever
 * (MIN(paidAt) per lower(email)); before `from` means returning. One hash join, no per-row
 * subquery.
 */
async function customerSplit(db: DbClient, r: ResolvedRange) {
  const [row] = await db.$queryRaw<{ new_customers: number; returning_customers: number }[]>`
    WITH c AS (SELECT DISTINCT lower(o."email") AS email FROM "Order" o WHERE ${counted(r)}),
    first_paid AS (
      SELECT lower(o."email") AS email, MIN(o."paidAt") AS first_at
      FROM "Order" o
      WHERE o."paidAt" IS NOT NULL AND o."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED')
        AND lower(o."email") IN (SELECT email FROM c)
      GROUP BY 1)
    SELECT (COUNT(*) FILTER (WHERE f.first_at >= ${utc(r.from)}))::int AS new_customers,
           (COUNT(*) FILTER (WHERE f.first_at < ${utc(r.from)}))::int AS returning_customers
    FROM first_paid f`;
  return {
    newCustomers: row?.new_customers ?? 0,
    returningCustomers: row?.returning_customers ?? 0,
  };
}

/** Active variants of non-archived products at or below their threshold (a current snapshot). */
export async function lowStockSkuCount(db: DbClient): Promise<number> {
  const [row] = await db.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
    WHERE v."isActive" AND p."status" <> 'ARCHIVED'
      AND v."stockOnHand" - v."stockReserved" <= v."lowStockThreshold"`;
  return row?.n ?? 0;
}

export async function periodKpis(
  db: DbClient,
  r: ResolvedRange,
  lowStockSkus: number,
): Promise<Kpis> {
  const [t, customers] = await Promise.all([periodTotals(db, r), customerSplit(db, r)]);
  const gross = num(t.gross);
  const margin =
    t.orders === 0 ? 0 : t.missing_cost ? null : num(t.lines) - num(t.discounts) - num(t.cost);
  return {
    revenueCents: gross - num(t.refunded),
    orders: t.orders,
    aovCents: t.orders === 0 ? 0 : Math.round(gross / t.orders),
    refundRate: t.orders === 0 ? 0 : t.refunded_orders / t.orders,
    ...customers,
    grossMarginCents: margin,
    lowStockSkus,
  };
}

type SeriesRow = { bucket: Date; orders: number; revenue: bigint; gross: bigint };

/** One row per UTC bucket from the bucket containing `from` up to `end`, zero-filled. */
export async function salesSeries(
  db: DbClient,
  r: ResolvedRange,
  interval: "day" | "week" | "month",
): Promise<SalesPoint[]> {
  const rows = await db.$queryRaw<SeriesRow[]>`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${interval}, ${utc(r.from)}),
        ${utc(r.end)} - interval '1 microsecond',
        (${`1 ${interval}`})::interval) AS bucket),
    sales AS (
      SELECT date_trunc(${interval}, o."paidAt") AS bucket,
             COUNT(*)::int AS orders,
             SUM(o."totalCents" - o."refundedCents")::bigint AS revenue,
             SUM(o."totalCents")::bigint AS gross
      FROM "Order" o WHERE ${counted(r)} GROUP BY 1)
    SELECT b.bucket, COALESCE(s.orders, 0)::int AS orders,
           COALESCE(s.revenue, 0)::bigint AS revenue, COALESCE(s.gross, 0)::bigint AS gross
    FROM buckets b LEFT JOIN sales s ON s.bucket = b.bucket
    ORDER BY b.bucket`;
  return rows.map((row) => ({
    bucket: row.bucket.toISOString(),
    orders: row.orders,
    revenueCents: num(row.revenue),
    aovCents: row.orders === 0 ? 0 : Math.round(num(row.gross) / row.orders),
  }));
}

const TOP_ORDER: Record<TopProductsQuery["by"], Prisma.Sql> = {
  revenue: Prisma.sql`revenue DESC, units DESC`,
  units: Prisma.sql`units DESC, revenue DESC`,
};

export async function topProducts(
  db: DbClient,
  r: ResolvedRange,
  by: TopProductsQuery["by"],
  limit: number,
): Promise<TopProduct[]> {
  const rows = await db.$queryRaw<{ id: string; name: string; units: number; revenue: bigint }[]>`
    SELECT p.id, p."name", SUM(i."quantity")::int AS units, SUM(i."lineTotalCents")::bigint AS revenue
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    JOIN "ProductVariant" v ON v.id = i."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE ${counted(r)}
    GROUP BY p.id, p."name"
    ORDER BY ${TOP_ORDER[by]}, p."name", p.id
    LIMIT ${limit}`;
  return rows.map((row) => ({
    productId: row.id,
    name: row.name,
    unitsSold: row.units,
    revenueCents: num(row.revenue),
  }));
}

export async function salesByCategory(db: DbClient, r: ResolvedRange): Promise<CategorySales[]> {
  const rows = await db.$queryRaw<
    { id: string; name: string; orders: number; units: number; revenue: bigint }[]
  >`
    SELECT c.id, c."name", COUNT(DISTINCT o.id)::int AS orders,
           SUM(i."quantity")::int AS units, SUM(i."lineTotalCents")::bigint AS revenue
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    JOIN "ProductVariant" v ON v.id = i."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE ${counted(r)}
    GROUP BY c.id, c."name"
    ORDER BY revenue DESC, c."name", c.id`;
  return rows.map((row) => ({
    categoryId: row.id,
    name: row.name,
    orders: row.orders,
    unitsSold: row.units,
    revenueCents: num(row.revenue),
  }));
}

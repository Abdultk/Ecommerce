import type { ReportType } from "@hp/contracts";
import type { DbClient } from "../../lib/prisma";
import { salesSeries, type ResolvedRange } from "../admin/analytics/analytics.queries";
import type { CellValue } from "./csv";

/** A failure whose message is safe to show the admin. */
export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

export const MAX_REPORT_ROWS = 100_000;

export type ReportTable = { columns: string[]; rows: CellValue[][] };

const tooLarge = () =>
  new ReportError(
    `The report has more than ${MAX_REPORT_ROWS.toLocaleString("en-US")} rows. Choose a shorter range.`,
  );

function capped<T>(rows: T[]): T[] {
  if (rows.length > MAX_REPORT_ROWS) throw tooLarge();
  return rows;
}

/** Orders created in the range, except unpaid checkouts. */
async function ordersTable(db: DbClient, r: ResolvedRange): Promise<ReportTable> {
  const orders = capped(
    await db.order.findMany({
      where: { createdAt: { gte: r.from, lt: r.end }, status: { not: "PENDING_PAYMENT" } },
      include: { items: { select: { quantity: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_REPORT_ROWS + 1,
    }),
  );
  return {
    columns: [
      "number",
      "created_at",
      "paid_at",
      "status",
      "email",
      "items",
      "subtotal_cents",
      "discount_cents",
      "shipping_cents",
      "tax_cents",
      "total_cents",
      "refunded_cents",
      "coupon_code",
    ],
    rows: orders.map((o) => [
      o.number,
      o.createdAt,
      o.paidAt,
      o.status,
      o.email,
      o.items.reduce((n, i) => n + i.quantity, 0),
      o.subtotalCents,
      o.discountCents,
      o.shippingCents,
      o.taxCents,
      o.totalCents,
      o.refundedCents,
      o.couponCode,
    ]),
  };
}

/** Daily sales with the analytics revenue rules (net revenue, gross AOV), zero-filled, UTC. */
async function salesByDayTable(db: DbClient, r: ResolvedRange): Promise<ReportTable> {
  const points = await salesSeries(db, r, "day");
  return {
    columns: ["date", "orders", "revenue_cents", "aov_cents"],
    rows: points.map((p) => [p.bucket.slice(0, 10), p.orders, p.revenueCents, p.aovCents]),
  };
}

/** Current stock for every variant (the range is ignored: stock has no history). */
async function inventoryTable(db: DbClient): Promise<ReportTable> {
  const variants = capped(
    await db.productVariant.findMany({
      include: { product: { select: { name: true, status: true } } },
      orderBy: { sku: "asc" },
      take: MAX_REPORT_ROWS + 1,
    }),
  );
  return {
    columns: [
      "sku",
      "product",
      "variant",
      "product_status",
      "active",
      "on_hand",
      "reserved",
      "available",
      "low_stock_threshold",
      "low_stock",
      "price_cents",
      "cost_cents",
    ],
    rows: variants.map((v) => {
      const available = Math.max(0, v.stockOnHand - v.stockReserved);
      return [
        v.sku,
        v.product.name,
        v.name,
        v.product.status,
        v.isActive,
        v.stockOnHand,
        v.stockReserved,
        available,
        v.lowStockThreshold,
        available <= v.lowStockThreshold,
        v.priceCents,
        v.costCents,
      ];
    }),
  };
}

type CustomerRow = {
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  orders: number;
  spent: bigint;
  lastOrderAt: Date | null;
};

/** Every customer account, with their paid orders (analytics rules) in the range. */
async function customersTable(db: DbClient, r: ResolvedRange): Promise<ReportTable> {
  const from = r.from.toISOString();
  const end = r.end.toISOString();
  const rows = capped(
    await db.$queryRaw<CustomerRow[]>`
      SELECT u."email", u."firstName", u."lastName", u."createdAt", u."emailVerifiedAt",
        (COUNT(o.id) FILTER (WHERE o."paidAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
                               AND o."paidAt" < (${end}::timestamptz AT TIME ZONE 'UTC')))::int AS orders,
        COALESCE(SUM(o."totalCents" - o."refundedCents") FILTER (
          WHERE o."paidAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
            AND o."paidAt" < (${end}::timestamptz AT TIME ZONE 'UTC')), 0)::bigint AS spent,
        MAX(o."paidAt") AS "lastOrderAt"
      FROM "User" u
      LEFT JOIN "Order" o ON o."userId" = u.id
        AND o."paidAt" IS NOT NULL AND o."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED')
      WHERE u."role" = 'CUSTOMER'
      GROUP BY u.id
      ORDER BY u."createdAt", u.id
      LIMIT ${MAX_REPORT_ROWS + 1}`,
  );
  return {
    columns: [
      "email",
      "first_name",
      "last_name",
      "signed_up_at",
      "email_verified",
      "orders_in_range",
      "net_spent_in_range_cents",
      "last_order_at",
    ],
    rows: rows.map((c) => [
      c.email,
      c.firstName,
      c.lastName,
      c.createdAt,
      c.emailVerifiedAt !== null,
      c.orders,
      Number(c.spent),
      c.lastOrderAt,
    ]),
  };
}

export function buildReportData(
  db: DbClient,
  type: ReportType,
  range: ResolvedRange,
): Promise<ReportTable> {
  switch (type) {
    case "orders":
      return ordersTable(db, range);
    case "sales-by-day":
      return salesByDayTable(db, range);
    case "inventory":
      return inventoryTable(db);
    case "customers":
      return customersTable(db, range);
  }
}

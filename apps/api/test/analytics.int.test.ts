import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import type { OrderStatus, ProductVariant } from "@prisma/client";
import {
  AnalyticsSummary,
  CategorySales,
  SalesPoint,
  TopProduct,
  envelope,
  formatOrderNumber,
} from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { OMAN_ADDRESS, bearer, buildApp, createUser, prisma, resetDb } from "./helpers";

const ctx = buildApp();
let admin = "";
let staff = "";
let a: ProductVariant; // cost 2000
let b: ProductVariant; // cost 1000, different category
let sequence = 0;

type Line = { variant: ProductVariant; quantity: number; unitPriceCents: number };

async function order(opts: {
  email: string;
  status: OrderStatus;
  paidAt: string | null;
  lines: Line[];
  discountCents?: number;
  refundedCents?: number;
}) {
  sequence += 1;
  const subtotal = opts.lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0);
  const discount = opts.discountCents ?? 0;
  return prisma.order.create({
    data: {
      number: formatOrderNumber(2026, sequence),
      email: opts.email,
      status: opts.status,
      subtotalCents: subtotal,
      discountCents: discount,
      shippingCents: 0,
      taxCents: 0,
      totalCents: subtotal - discount,
      refundedCents: opts.refundedCents ?? 0,
      shippingAddress: OMAN_ADDRESS,
      shippingMethod: "standard",
      paymentMethod: "CARD",
      paidAt: opts.paidAt ? new Date(opts.paidAt) : null,
      items: {
        create: opts.lines.map((l) => ({
          variantId: l.variant.id,
          productName: "snapshot",
          variantName: l.variant.name,
          sku: l.variant.sku,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.unitPriceCents * l.quantity,
        })),
      },
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  sequence = 0;
  admin = bearer(await createUser({ role: "ADMIN", email: "admin@example.test" }));
  staff = bearer(await createUser({ role: "STAFF", email: "staff@example.test" }));
  const variants = await prisma.productVariant.findMany({
    include: { product: true },
    orderBy: { sku: "asc" },
  });
  const first = variants[0]!;
  const second = variants.find((v) => v.product.categoryId !== first.product.categoryId)!;
  a = await prisma.productVariant.update({ where: { id: first.id }, data: { costCents: 2_000 } });
  b = await prisma.productVariant.update({ where: { id: second.id }, data: { costCents: 1_000 } });

  // Before both periods: makes ada a returning customer.
  await order({
    email: "ada@example.test",
    status: "DELIVERED",
    paidAt: "2026-07-01T10:00:00Z",
    lines: [{ variant: a, quantity: 1, unitPriceCents: 1_000 }],
  });
  // Previous period (2026-08-02 .. 2026-09-01)
  await order({
    email: "bo@example.test",
    status: "PAID",
    paidAt: "2026-08-20T10:00:00Z",
    lines: [{ variant: a, quantity: 1, unitPriceCents: 5_000 }],
  });
  // Current period (September)
  await order({
    email: "ada@example.test",
    status: "PAID",
    paidAt: "2026-09-02T10:00:00Z",
    discountCents: 1_000,
    lines: [{ variant: a, quantity: 2, unitPriceCents: 5_000 }],
  });
  await order({
    email: "BO@example.test",
    status: "DELIVERED",
    paidAt: "2026-09-02T15:00:00Z",
    refundedCents: 1_000,
    lines: [{ variant: b, quantity: 1, unitPriceCents: 3_000 }],
  });
  await order({
    email: "ada@example.test",
    status: "SHIPPED",
    paidAt: "2026-09-10T08:00:00Z",
    lines: [{ variant: a, quantity: 1, unitPriceCents: 5_000 }],
  });
  await order({
    email: "dee@example.test",
    status: "REFUNDED",
    paidAt: "2026-09-20T08:00:00Z",
    refundedCents: 6_000,
    lines: [{ variant: b, quantity: 2, unitPriceCents: 3_000 }],
  });
  // Never counted: cancelled (even though it was paid) and unpaid checkouts.
  await order({
    email: "cy@example.test",
    status: "CANCELLED",
    paidAt: "2026-09-05T08:00:00Z",
    refundedCents: 4_000,
    lines: [{ variant: a, quantity: 1, unitPriceCents: 4_000 }],
  });
  await order({
    email: "cy@example.test",
    status: "PENDING_PAYMENT",
    paidAt: null,
    lines: [{ variant: b, quantity: 5, unitPriceCents: 3_000 }],
  });
});

const get = (path: string, token = admin) =>
  request(ctx.app).get(`/api/v1/admin/analytics${path}`).set("Authorization", token);

const RANGE = "from=2026-09-01&to=2026-09-30";

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = envelope(schema).parse(body) as unknown as { success: boolean; data: T };
  if (!parsed.success) throw new Error("expected success");
  return parsed.data;
};

describe("permissions and validation", () => {
  it("needs analytics:read", async () => {
    for (const path of ["/summary", "/sales-timeseries", "/top-products", "/sales-by-category"]) {
      expect((await get(`${path}?${RANGE}`, staff)).status).toBe(403);
      expect((await request(ctx.app).get(`/api/v1/admin/analytics${path}?${RANGE}`)).status).toBe(
        401,
      );
    }
  });

  it("rejects a reversed or missing range", async () => {
    expect((await get("/summary?from=2026-09-30&to=2026-09-01")).status).toBe(400);
    expect((await get("/summary")).status).toBe(400);
    expect((await get(`/sales-timeseries?${RANGE}&interval=hour`)).status).toBe(400);
    expect((await get(`/top-products?${RANGE}&limit=500`)).status).toBe(400);
  });
});

describe("GET /admin/analytics/summary", () => {
  it("computes KPIs against the previous period of equal length", async () => {
    const res = await get(`/summary?${RANGE}`);
    expect(res.status).toBe(200);
    const lowStock = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE v."isActive" AND p.status <> 'ARCHIVED'
        AND v."stockOnHand" - v."stockReserved" <= v."lowStockThreshold"`;
    expect(parse(AnalyticsSummary, res.body)).toEqual({
      current: {
        revenueCents: 16_000, // 23,000 gross − 7,000 refunded
        orders: 4,
        aovCents: 5_750,
        refundRate: 0.5,
        newCustomers: 1,
        returningCustomers: 2,
        grossMarginCents: 14_000, // 24,000 items − 1,000 discount − 9,000 cost
        lowStockSkus: lowStock[0]!.n,
      },
      previous: {
        revenueCents: 5_000,
        orders: 1,
        aovCents: 5_000,
        refundRate: 0,
        newCustomers: 1,
        returningCustomers: 0,
        grossMarginCents: 3_000,
        lowStockSkus: lowStock[0]!.n,
      },
      currency: "OMR",
    });
  });

  it("reports no margin when a sold variant has no cost", async () => {
    await prisma.productVariant.update({ where: { id: b.id }, data: { costCents: null } });
    const data = parse(AnalyticsSummary, (await get(`/summary?${RANGE}`)).body);
    expect(data.current.grossMarginCents).toBeNull();
    expect(data.previous.grossMarginCents).toBe(3_000); // only variant a sold then
  });

  it("returns zeros for an empty period", async () => {
    const data = parse(
      AnalyticsSummary,
      (await get("/summary?from=2025-01-01&to=2025-01-31")).body,
    );
    expect(data.current).toMatchObject({
      revenueCents: 0,
      orders: 0,
      aovCents: 0,
      refundRate: 0,
      grossMarginCents: 0,
    });
  });

  it("includes a whole day for a date-only end but not for an exact-midnight timestamp", async () => {
    const dateOnly = parse(
      AnalyticsSummary,
      (await get("/summary?from=2026-09-01&to=2026-09-02")).body,
    );
    expect(dateOnly.current.orders).toBe(2);
    const midnight = parse(
      AnalyticsSummary,
      (await get("/summary?from=2026-09-01&to=2026-09-02T00:00:00Z")).body,
    );
    expect(midnight.current.orders).toBe(0);
  });

  it("treats a timestamp end as exclusive", async () => {
    const data = parse(
      AnalyticsSummary,
      (await get("/summary?from=2026-09-02T00:00:00Z&to=2026-09-02T12:00:00Z")).body,
    );
    expect(data.current.orders).toBe(1);
  });
});

describe("GET /admin/analytics/sales-timeseries", () => {
  it("returns one zero-filled UTC bucket per day", async () => {
    const points = parse(z.array(SalesPoint), (await get(`/sales-timeseries?${RANGE}`)).body);
    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({
      bucket: "2026-09-01T00:00:00.000Z",
      orders: 0,
      revenueCents: 0,
      aovCents: 0,
    });
    expect(points[1]).toEqual({
      bucket: "2026-09-02T00:00:00.000Z",
      orders: 2,
      revenueCents: 11_000,
      aovCents: 6_000,
    });
    expect(points.reduce((n, p) => n + p.revenueCents, 0)).toBe(16_000);
  });

  it("buckets by ISO week and by month", async () => {
    const weeks = parse(
      z.array(SalesPoint),
      (await get(`/sales-timeseries?${RANGE}&interval=week`)).body,
    );
    expect(weeks.map((w) => w.bucket.slice(0, 10))).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    const months = parse(
      z.array(SalesPoint),
      (await get(`/sales-timeseries?${RANGE}&interval=month`)).body,
    );
    expect(months).toEqual([
      { bucket: "2026-09-01T00:00:00.000Z", orders: 4, revenueCents: 16_000, aovCents: 5_750 },
    ]);
  });
});

describe("GET /admin/analytics/top-products", () => {
  it("ranks by item revenue by default and by units on request", async () => {
    const byRevenue = parse(z.array(TopProduct), (await get(`/top-products?${RANGE}`)).body);
    expect(byRevenue.map((p) => [p.productId, p.unitsSold, p.revenueCents])).toEqual([
      [a.productId, 3, 15_000],
      [b.productId, 3, 9_000],
    ]);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.productId } });
    expect(byRevenue[0]!.name).toBe(product.name);

    const top1 = parse(
      z.array(TopProduct),
      (await get(`/top-products?${RANGE}&by=units&limit=1`)).body,
    );
    expect(top1).toHaveLength(1);
  });
});

describe("GET /admin/analytics/sales-by-category", () => {
  it("sums item revenue, units and orders per category", async () => {
    const rows = parse(z.array(CategorySales), (await get(`/sales-by-category?${RANGE}`)).body);
    const pa = await prisma.product.findUniqueOrThrow({
      where: { id: a.productId },
      include: { category: true },
    });
    const pb = await prisma.product.findUniqueOrThrow({
      where: { id: b.productId },
      include: { category: true },
    });
    expect(rows).toEqual([
      {
        categoryId: pa.categoryId,
        name: pa.category.name,
        orders: 2,
        unitsSold: 3,
        revenueCents: 15_000,
      },
      {
        categoryId: pb.categoryId,
        name: pb.category.name,
        orders: 2,
        unitsSold: 3,
        revenueCents: 9_000,
      },
    ]);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { Category, ProductDetail, ProductFacets, ProductSummary, envelope } from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";
import { seedCatalog } from "../prisma/seed";
import { buildApp, prisma, resetDb } from "./helpers";

const { app } = buildApp();
const listEnvelope = envelope(z.array(ProductSummary));

beforeAll(async () => {
  await resetDb();
  await seedCatalog(prisma);
});

const slugs = async (query: string) => {
  const res = await request(app).get(`/api/v1/products?${query}`);
  expect(res.status).toBe(200);
  const body = listEnvelope.parse(res.body);
  if (!body.success) throw new Error("expected success");
  return body.data.map((p) => p.slug);
};

describe("GET /categories", () => {
  it("returns the category tree", async () => {
    const res = await request(app).get("/api/v1/categories");
    const body = envelope(z.array(Category)).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.map((c) => c.slug)).toEqual([
      "cookware",
      "knives-cutlery",
      "utensils-tools",
      "storage",
      "small-appliances",
    ]);
    expect(body.data[0]?.children.map((c) => c.slug)).toEqual([
      "skillets",
      "dutch-ovens",
      "saucepans",
    ]);
  });
});

describe("GET /products", () => {
  it("lists every active product with paging metadata", async () => {
    const res = await request(app).get("/api/v1/products?pageSize=5");
    const body = listEnvelope.parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data).toHaveLength(5);
    expect(body.meta).toEqual({
      page: 1,
      pageSize: 5,
      total: sampleCatalog().length,
      totalPages: 2,
    });
  });

  it("tolerates typos via trigram similarity", async () => {
    expect(await slugs("q=skilet")).toContain("cast-iron-skillet-10in");
  });

  it("finds products by description words via full-text search", async () => {
    expect(await slugs("q=braises")).toEqual(["enameled-dutch-oven-5-5qt"]);
  });

  it.each([
    ["category=skillets", ["cast-iron-skillet-10in"]],
    [
      "category=cookware",
      ["cast-iron-skillet-10in", "enameled-dutch-oven-5-5qt", "tri-ply-saucepan-2qt"],
    ],
    ["brand=Northfold", ["end-grain-cutting-board", "enameled-dutch-oven-5-5qt"]],
    ["material=Maple", ["end-grain-cutting-board"]],
    ["inStock=false", ["digital-kitchen-scale"]],
    ["minPrice=80000", ["enameled-dutch-oven-5-5qt"]],
  ])("filters with %s", async (query, expected) => {
    expect((await slugs(query)).sort()).toEqual([...expected].sort());
  });

  it("includes child categories when filtering by a parent", async () => {
    expect(await slugs("category=knives-cutlery")).toEqual(["chefs-knife-8in"]);
  });

  it("sorts by price both ways", async () => {
    const res = await request(app).get("/api/v1/products?sort=price_asc");
    const prices = res.body.data.map((p: { fromPriceCents: number }) => p.fromPriceCents);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
    const desc = await request(app).get("/api/v1/products?sort=price_desc");
    expect(desc.body.data[0].slug).toBe("enameled-dutch-oven-5-5qt");
  });

  it("rejects invalid query parameters", async () => {
    const res = await request(app).get("/api/v1/products?pageSize=500");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("treats SQL in the search term as plain text", async () => {
    expect(await slugs(`q=${encodeURIComponent('\'; DROP TABLE "Product"; --')}`)).toEqual([]);
    expect(await prisma.product.count()).toBe(sampleCatalog().length);
  });
});

describe("GET /products/facets (SQL GROUP BY)", () => {
  it("matches the search results exactly, including typo matches", async () => {
    for (const query of ["", "q=skilet", "q=pan", "category=cookware&inStock=true"]) {
      const list = await request(app).get(`/api/v1/products?pageSize=100&${query}`);
      const facets = await request(app).get(`/api/v1/products/facets?${query}`);
      const body = envelope(ProductFacets).parse(facets.body);
      if (!body.success) throw new Error("expected success");
      const items = list.body.data as { brand: string | null; fromPriceCents: number }[];
      expect(body.data.priceRanges.reduce((n, r) => n + r.count, 0)).toBe(items.length);
      const brands = new Map<string, number>();
      for (const item of items)
        if (item.brand) brands.set(item.brand, (brands.get(item.brand) ?? 0) + 1);
      expect(Object.fromEntries(body.data.brands.map((b) => [b.value, b.count]))).toEqual(
        Object.fromEntries(brands),
      );
      for (const range of body.data.priceRanges) {
        const inRange = items.filter(
          (i) =>
            i.fromPriceCents >= range.minCents &&
            (range.maxCents === null || i.fromPriceCents < range.maxCents),
        );
        expect(range.count).toBe(inRange.length);
      }
    }
  });
});

describe("GET /products/facets", () => {
  it("counts brands and materials for the current search", async () => {
    const res = await request(app).get("/api/v1/products/facets?category=cookware");
    const body = envelope(ProductFacets).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.brands).toEqual(
      expect.arrayContaining([
        { value: "Ironvale", count: 1 },
        { value: "Northfold", count: 1 },
        { value: "Copperline", count: 1 },
      ]),
    );
    expect(body.data.priceRanges.reduce((n, r) => n + r.count, 0)).toBe(3);
  });
});

describe("GET /products/:slug", () => {
  it("returns full detail with available stock per variant", async () => {
    const res = await request(app).get("/api/v1/products/enameled-dutch-oven-5-5qt");
    const body = envelope(ProductDetail).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.variants.map((v) => [v.sku, v.stockAvailable])).toEqual([
      ["NF-DO55-COB", 6],
      ["NF-DO55-SAG", 0],
    ]);
    expect(body.data.inStock).toBe(true);
  });

  it("returns 404 for unknown and draft products", async () => {
    expect((await request(app).get("/api/v1/products/no-such-pan")).status).toBe(404);
    await prisma.product.update({ where: { slug: "chefs-knife-8in" }, data: { status: "DRAFT" } });
    expect((await request(app).get("/api/v1/products/chefs-knife-8in")).status).toBe(404);
    expect(await slugs("q=knife")).not.toContain("chefs-knife-8in");
    await prisma.product.update({ where: { slug: "chefs-knife-8in" }, data: { status: "ACTIVE" } });
  });

  it("hides inactive variants", async () => {
    await prisma.productVariant.update({ where: { sku: "IV-SK12" }, data: { isActive: false } });
    const res = await request(app).get("/api/v1/products/cast-iron-skillet-10in");
    expect(res.body.data.variants.map((v: { sku: string }) => v.sku)).toEqual(["IV-SK10"]);
    await prisma.productVariant.update({ where: { sku: "IV-SK12" }, data: { isActive: true } });
  });

  it("reflects reserved stock", async () => {
    await prisma.productVariant.update({ where: { sku: "BR-CK8" }, data: { stockReserved: 28 } });
    const res = await request(app).get("/api/v1/products/chefs-knife-8in");
    expect(res.body.data.variants[0].stockAvailable).toBe(2);
    await prisma.productVariant.update({ where: { sku: "BR-CK8" }, data: { stockReserved: 0 } });
  });
});

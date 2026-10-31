import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { z } from "zod";
import {
  Cart,
  Category,
  ProductDetail,
  ProductFacets,
  ProductSummary,
  envelope,
} from "@hp/contracts";
import { createMockApiHandlers } from "../src/msw/handlers";
import { sampleCatalog } from "../src/factories";

const BASE = "http://api.test/api/v1";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const useHandlers = () => server.use(...createMockApiHandlers(BASE));

async function getJson(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return { status: res.status, body: await res.json() };
}

describe("GET /products", () => {
  it("returns a contract-valid paged list", async () => {
    useHandlers();
    const { status, body } = await getJson("/products?pageSize=3");
    expect(status).toBe(200);
    const parsed = envelope(z.array(ProductSummary)).parse(body);
    if (!parsed.success) throw new Error(`Expected success, got ${parsed.error.code}`);
    expect(parsed.data).toHaveLength(3);
    expect(parsed.meta).toMatchObject({ page: 1, pageSize: 3, total: sampleCatalog().length });
  });

  it("filters by search term, case-insensitively", async () => {
    useHandlers();
    const { body } = await getJson("/products?q=SKILLET");
    expect(body.data.map((p: { slug: string }) => p.slug)).toContain("cast-iron-skillet-10in");
    expect(body.data.every((p: { name: string }) => /skillet/i.test(p.name))).toBe(true);
  });

  it("filters to in-stock items and sorts by price", async () => {
    useHandlers();
    const { body } = await getJson("/products?inStock=true&sort=price_asc");
    const prices = body.data.map((p: { fromPriceCents: number }) => p.fromPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(body.data.every((p: { inStock: boolean }) => p.inStock)).toBe(true);
  });

  it.each([
    ["category=skillets", ["cast-iron-skillet-10in"]],
    ["brand=Northfold", ["enameled-dutch-oven-5-5qt", "end-grain-cutting-board"]],
    ["material=Maple", ["end-grain-cutting-board"]],
    ["inductionCompatible=true&maxPrice=7000", ["cast-iron-skillet-10in", "tri-ply-saucepan-2qt"]],
    ["minPrice=20000", ["enameled-dutch-oven-5-5qt"]],
    ["inStock=false", ["digital-kitchen-scale"]],
    [
      "inductionCompatible=false&category=chefs-knives",
      ["chefs-knife-8in"], // not induction-compatible (null counts as "no")
    ],
  ])("filters with %s", async (query, expected) => {
    useHandlers();
    const { body } = await getJson(`/products?${query}`);
    expect(body.data.map((p: { slug: string }) => p.slug).sort()).toEqual([...expected].sort());
  });

  it.each([
    ["price_desc", "fromPriceCents", (a: number, b: number) => b - a],
    ["popular", "ratingCount", (a: number, b: number) => b - a],
  ] as const)("sorts by %s", async (sort, field, compare) => {
    useHandlers();
    const { body } = await getJson(`/products?sort=${sort}`);
    const values = body.data.map((p: Record<string, number>) => p[field]);
    expect(values).toEqual([...values].sort(compare));
  });

  it("paginates past the first page", async () => {
    useHandlers();
    const { body } = await getJson("/products?pageSize=5&page=2");
    expect(body.data).toHaveLength(sampleCatalog().length - 5);
    expect(body.meta.totalPages).toBe(2);
  });

  it("returns a VALIDATION_ERROR envelope for bad query params", async () => {
    useHandlers();
    const { status, body } = await getJson("/products?pageSize=500");
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /products/:slug", () => {
  it("returns the product detail", async () => {
    useHandlers();
    const { body } = await getJson("/products/cast-iron-skillet-10in");
    expect(envelope(ProductDetail).parse(body).data?.name).toMatch(/Skillet/);
  });

  it("returns NOT_FOUND for an unknown slug", async () => {
    useHandlers();
    const { status, body } = await getJson("/products/no-such-pan");
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /categories", () => {
  it("returns the category tree", async () => {
    useHandlers();
    const { body } = await getJson("/categories");
    expect(envelope(z.array(Category)).parse(body).data?.length).toBeGreaterThan(0);
  });
});

describe("cart", () => {
  const firstInStock = () => sampleCatalog().find((p) => p.inStock)!.variants[0]!;
  const outOfStock = () => sampleCatalog().find((p) => !p.inStock)!.variants[0]!;

  it("starts empty", async () => {
    useHandlers();
    const { body } = await getJson("/cart");
    expect(envelope(Cart).parse(body).data?.items).toEqual([]);
  });

  it("adds an item and recomputes totals", async () => {
    useHandlers();
    const variant = firstInStock();
    const post = await getJson("/cart/items", {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 2 }),
    });
    expect(post.status).toBe(200);
    const cart = envelope(Cart).parse(post.body).data!;
    expect(cart.items[0]).toMatchObject({ variantId: variant.id, quantity: 2 });
    expect(cart.totals.subtotalCents).toBe(variant.priceCents * 2);

    const again = await getJson("/cart");
    expect(again.body.data.items).toHaveLength(1);
  });

  it("merges quantity when the same variant is added twice", async () => {
    useHandlers();
    const variant = firstInStock();
    const add = () =>
      getJson("/cart/items", {
        method: "POST",
        body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
      });
    await add();
    const { body } = await add();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].quantity).toBe(2);
  });

  it("rejects quantities above available stock with OUT_OF_STOCK", async () => {
    useHandlers();
    const { status, body } = await getJson("/cart/items", {
      method: "POST",
      body: JSON.stringify({ variantId: outOfStock().id, quantity: 1 }),
    });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { available: 0 } });
  });

  it("rejects an unknown variant with NOT_FOUND", async () => {
    useHandlers();
    const { status } = await getJson("/cart/items", {
      method: "POST",
      body: JSON.stringify({ variantId: "nope", quantity: 1 }),
    });
    expect(status).toBe(404);
  });

  it("rejects an invalid body with VALIDATION_ERROR", async () => {
    useHandlers();
    const { status, body } = await getJson("/cart/items", {
      method: "POST",
      body: JSON.stringify({ variantId: firstInStock().id, quantity: 0 }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("keeps state separate between handler sets", async () => {
    useHandlers();
    await getJson("/cart/items", {
      method: "POST",
      body: JSON.stringify({ variantId: firstInStock().id, quantity: 1 }),
    });
    server.resetHandlers();
    useHandlers();
    const { body } = await getJson("/cart");
    expect(body.data.items).toEqual([]);
  });
});

describe("parity with the real API", () => {
  it("includes subcategories when filtering by a parent category", async () => {
    useHandlers();
    const { body } = await getJson("/products?category=cookware");
    expect(body.data.map((p: { slug: string }) => p.slug).sort()).toEqual([
      "cast-iron-skillet-10in",
      "enameled-dutch-oven-5-5qt",
      "tri-ply-saucepan-2qt",
    ]);
  });

  it("serves contract-valid facets that ignore the facet filters themselves", async () => {
    useHandlers();
    const { body } = await getJson("/products/facets?category=cookware&brand=Ironvale");
    const parsed = envelope(ProductFacets).parse(body);
    if (!parsed.success) throw new Error("expected success");
    expect(parsed.data.brands.map((b) => b.value).sort()).toEqual([
      "Copperline",
      "Ironvale",
      "Northfold",
    ]);
    expect(parsed.data.priceRanges.reduce((n, r) => n + r.count, 0)).toBe(3);
  });

  it("updates and removes cart lines", async () => {
    useHandlers();
    const variant = sampleCatalog().find((p) => p.inStock)!.variants[0]!;
    const added = await getJson("/cart/items", {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
    });
    const lineId = added.body.data.items[0].id;

    const patched = await getJson(`/cart/items/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity: 3 }),
    });
    expect(envelope(Cart).parse(patched.body).data).toMatchObject({ items: [{ quantity: 3 }] });

    const tooMany = await getJson(`/cart/items/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity: variant.stockAvailable + 1 }),
    });
    expect(tooMany.status).toBe(409);

    const removed = await getJson(`/cart/items/${lineId}`, { method: "DELETE" });
    expect(removed.body.data.items).toEqual([]);

    const missing = await getJson(`/cart/items/${lineId}`, { method: "DELETE" });
    expect(missing.status).toBe(404);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  Cart,
  Category,
  OrderDetail,
  ProductDetail,
  ProductSummary,
  PublicUser,
} from "@hp/contracts";
import {
  makeCart,
  makeCartLine,
  makeCategoryTree,
  makeOrderDetail,
  makeProductDetail,
  makePublicUser,
  resetFactorySequence,
  sampleCatalog,
  toSummary,
} from "../src/factories";

beforeEach(resetFactorySequence);

describe("sampleCatalog", () => {
  it("returns contract-valid kitchen products with unique slugs and SKUs", () => {
    const catalog = sampleCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    catalog.forEach((p) => ProductDetail.parse(p));
    expect(new Set(catalog.map((p) => p.slug)).size).toBe(catalog.length);
    const skus = catalog.flatMap((p) => p.variants.map((v) => v.sku));
    expect(new Set(skus).size).toBe(skus.length);
  });

  it("includes at least one out-of-stock product for empty-state tests", () => {
    expect(sampleCatalog().some((p) => !p.inStock)).toBe(true);
  });

  it("returns fresh objects each call so tests cannot leak mutations", () => {
    const a = sampleCatalog();
    const b = sampleCatalog();
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("product factories", () => {
  it("applies overrides on top of valid defaults", () => {
    const product = makeProductDetail({ name: "Carbon Steel Wok", slug: "carbon-steel-wok" });
    expect(product.name).toBe("Carbon Steel Wok");
    expect(ProductDetail.safeParse(product).success).toBe(true);
  });

  it("generates distinct ids and SKUs per call", () => {
    const a = makeProductDetail();
    const b = makeProductDetail();
    expect(a.id).not.toBe(b.id);
    expect(a.variants[0]?.sku).not.toBe(b.variants[0]?.sku);
  });

  it("derives a summary with the lowest variant price and stock flag", () => {
    const product = makeProductDetail();
    const summary = toSummary(product);
    expect(ProductSummary.safeParse(summary).success).toBe(true);
    expect(summary.fromPriceCents).toBe(Math.min(...product.variants.map((v) => v.priceCents)));
  });

  it("throws when an override breaks the contract", () => {
    expect(() => makeProductDetail({ slug: "Not A Slug" })).toThrow();
  });
});

describe("makeCart", () => {
  it("computes totals that satisfy the contract invariant", () => {
    const cart = makeCart([makeCartLine({ unitPriceCents: 3499, quantity: 2 })], {
      shippingCents: 799,
    });
    expect(Cart.safeParse(cart).success).toBe(true);
    expect(cart.totals).toMatchObject({
      subtotalCents: 6998,
      shippingCents: 799,
      totalCents: 7797,
    });
  });

  it("builds an empty cart by default", () => {
    expect(makeCart().items).toEqual([]);
    expect(makeCart().totals.totalCents).toBe(0);
  });
});

describe("other factories", () => {
  it("makeOrderDetail produces a valid paid order", () => {
    const order = makeOrderDetail();
    expect(OrderDetail.safeParse(order).success).toBe(true);
    expect(order.status).toBe("PAID");
  });

  it("makePublicUser defaults to a customer and accepts a role override", () => {
    expect(makePublicUser().role).toBe("CUSTOMER");
    expect(PublicUser.parse(makePublicUser({ role: "ADMIN" })).role).toBe("ADMIN");
  });

  it("makeCategoryTree returns a valid tree covering the sample catalog", () => {
    const tree = makeCategoryTree();
    tree.forEach((c) => Category.parse(c));
    const slugs = tree.flatMap((c) => [c.slug, ...c.children.map((child) => child.slug)]);
    sampleCatalog().forEach((p) => expect(slugs).toContain(p.categorySlug));
  });
});

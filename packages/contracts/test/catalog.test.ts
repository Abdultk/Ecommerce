import { describe, expect, it } from "vitest";
import { Category, ProductDetail, ProductQuery, Slug } from "../src/catalog";

describe("ProductQuery", () => {
  it("applies defaults for an empty query", () => {
    expect(ProductQuery.parse({})).toEqual({ sort: "relevance", page: 1, pageSize: 24 });
  });

  it("coerces numeric query-string values", () => {
    const q = ProductQuery.parse({ page: "3", pageSize: "48", minPrice: "1000", maxPrice: "5000" });
    expect(q).toMatchObject({ page: 3, pageSize: 48, minPrice: 1000, maxPrice: 5000 });
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("parses inStock=%s as %s", (raw, expected) => {
    expect(ProductQuery.parse({ inStock: raw }).inStock).toBe(expected);
  });

  it("rejects an unrecognized boolean string", () => {
    expect(ProductQuery.safeParse({ inStock: "maybe" }).success).toBe(false);
  });

  it("wraps a single brand value in an array", () => {
    expect(ProductQuery.parse({ brand: "Lodge" }).brand).toEqual(["Lodge"]);
    expect(ProductQuery.parse({ brand: ["Lodge", "Staub"] }).brand).toEqual(["Lodge", "Staub"]);
  });

  it("trims the search term and drops it when blank", () => {
    expect(ProductQuery.parse({ q: "  skillet " }).q).toBe("skillet");
    expect(ProductQuery.parse({ q: "   " }).q).toBeUndefined();
  });

  it("caps pageSize at 100", () => {
    expect(ProductQuery.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects a minimum price above the maximum", () => {
    const result = ProductQuery.safeParse({ minPrice: "5000", maxPrice: "1000" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown sort keys", () => {
    expect(ProductQuery.safeParse({ sort: "cheapest" }).success).toBe(false);
  });
});

describe("Slug", () => {
  it.each(["cast-iron-skillet-10in", "knives", "a1"])("accepts %s", (slug) => {
    expect(Slug.safeParse(slug).success).toBe(true);
  });

  it.each(["Cast-Iron", "skillet--10", "-pan", "pan-", "pan/../etc", ""])("rejects %s", (slug) => {
    expect(Slug.safeParse(slug).success).toBe(false);
  });
});

describe("Category", () => {
  it("parses a nested category tree", () => {
    const tree = Category.parse({
      id: "c1",
      slug: "cookware",
      name: "Cookware",
      children: [
        { id: "c2", slug: "skillets", name: "Skillets", children: [] },
        { id: "c3", slug: "dutch-ovens", name: "Dutch Ovens", children: [] },
      ],
    });
    expect(tree.children.map((c) => c.slug)).toEqual(["skillets", "dutch-ovens"]);
  });
});

describe("ProductDetail", () => {
  it("parses a realistic product with kitchen specs", () => {
    const product = ProductDetail.parse({
      id: "p1",
      slug: "cast-iron-skillet-10in",
      name: 'Cast Iron Skillet 10"',
      brand: "Lodge",
      categorySlug: "skillets",
      fromPriceCents: 3499,
      thumbnailUrl: "https://cdn.example.test/products/skillet.webp",
      ratingAvg: 4.7,
      ratingCount: 1290,
      inStock: true,
      description: "<p>Pre-seasoned and ready to cook.</p>",
      material: "Cast iron",
      careInstructions: "Hand wash, dry immediately, oil lightly.",
      dishwasherSafe: false,
      inductionCompatible: true,
      ovenSafeToF: 500,
      images: [
        {
          id: "i1",
          url: "https://cdn.example.test/products/skillet.webp",
          alt: "Skillet",
          position: 0,
        },
      ],
      variants: [
        {
          id: "v1",
          sku: "LDG-SK10",
          name: "10 inch",
          priceCents: 3499,
          compareAtPriceCents: null,
          stockAvailable: 12,
          attributes: { size: "10in" },
        },
      ],
    });
    expect(product.variants[0]?.priceCents).toBe(3499);
  });

  it("rejects fractional prices", () => {
    const result = ProductDetail.shape.variants.element.safeParse({
      id: "v1",
      sku: "X",
      name: "X",
      priceCents: 34.99,
      compareAtPriceCents: null,
      stockAvailable: 1,
      attributes: {},
    });
    expect(result.success).toBe(false);
  });
});

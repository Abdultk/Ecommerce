import { http, HttpResponse } from "msw";
import {
  ProductDetail,
  ProductQuery,
  ProductSummary,
  fail,
  ok,
  paged,
  type ProductSort,
} from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";
import { createMockApiHandlers } from "@hp/test-utils/msw";
import { createAccountHandlers } from "./account";
import { createAuthHandlers } from "./auth";
import { createCheckoutHandlers } from "./checkout";
import { createOrderHandlers } from "./orders";
import { createReviewHandlers } from "./reviews";
import { initialMockState } from "./seed";
import { createMockStore } from "./state";
import { createSettingsHandlers } from "./settings";
import { createStoreHandlers } from "./store";
import { ALL_DEMO_PRODUCTS, CATEGORY_PARENT_MAP, DEMO_CATEGORIES } from "./demo-data";

function searchParamsToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    out[key] = values.length === 1 ? values[0]! : values;
  }
  return out;
}

const SORTERS: Record<ProductSort, (a: ProductDetail, b: ProductDetail) => number> = {
  relevance: () => 0,
  newest: (a, b) => b.id.localeCompare(a.id),
  price_asc: (a, b) => a.fromPriceCents - b.fromPriceCents,
  price_desc: (a, b) => b.fromPriceCents - a.fromPriceCents,
  popular: (a, b) => b.ratingCount - a.ratingCount,
};

const PRICE_BUCKETS = [
  { minCents: 0, maxCents: 25_000 },
  { minCents: 25_000, maxCents: 50_000 },
  { minCents: 50_000, maxCents: 100_000 },
  { minCents: 100_000, maxCents: 200_000 },
  { minCents: 200_000, maxCents: null },
];

function toSummary(p: ProductDetail): ProductSummary {
  return ProductSummary.parse({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    categorySlug: p.categorySlug,
    fromPriceCents: p.fromPriceCents,
    thumbnailUrl: p.thumbnailUrl,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    inStock: p.inStock,
  });
}

function getCombinedCatalog(): ProductDetail[] {
  const rawSample = sampleCatalog();
  if (process.env.NODE_ENV === "test") {
    return rawSample;
  }
  const sampleSlugs = new Set(rawSample.map((s) => s.slug));
  const sample = rawSample.map((p) => {
    const url = `http://localhost:3000/products/${p.slug}.jpg`;
    return ProductDetail.parse({
      ...p,
      thumbnailUrl: url,
      images: [{ id: `img_${p.slug}`, url, alt: p.name, position: 0 }],
    });
  });

  const additions = ALL_DEMO_PRODUCTS.filter((p) => !sampleSlugs.has(p.slug));
  return [...sample, ...additions];
}

/**
 * Rich mock handlers providing the full 50+ item catalog across Home, Men, Women, Kids,
 * Electronics, Home & Living, and Sale with high-resolution imagery and instant responsiveness.
 */
export function createAppMockHandlers(baseUrl: string) {
  const products = getCombinedCatalog();
  const store = createMockStore(baseUrl, products, initialMockState(products));

  return [
    // Categories endpoint
    http.get(`${baseUrl}/categories`, () => HttpResponse.json(ok(DEMO_CATEGORIES))),

    // Products list with full category hierarchy and filters
    http.get(`${baseUrl}/products`, ({ request }) => {
      const parsed = ProductQuery.safeParse(searchParamsToObject(new URL(request.url)));
      if (!parsed.success) {
        return HttpResponse.json(
          fail("VALIDATION_ERROR", "Some filters are invalid.", parsed.error.flatten().fieldErrors),
          { status: 400 },
        );
      }
      const q = parsed.data;
      const matched = products.filter((p) => {
        if (q.q) {
          const needle = q.q.toLowerCase();
          const inName = p.name.toLowerCase().includes(needle);
          const inBrand = (p.brand ?? "").toLowerCase().includes(needle);
          const inDesc = p.description.toLowerCase().includes(needle);
          if (!inName && !inBrand && !inDesc) return false;
        }
        if (q.category) {
          const parent = CATEGORY_PARENT_MAP.get(p.categorySlug);
          if (p.categorySlug !== q.category && parent !== q.category) return false;
        }
        if (q.brand && q.brand.length > 0 && (!p.brand || !q.brand.includes(p.brand))) {
          return false;
        }
        if (q.material && q.material.length > 0 && (!p.material || !q.material.includes(p.material))) {
          return false;
        }
        if (q.inStock !== undefined && p.inStock !== q.inStock) return false;
        if (q.minPrice !== undefined && p.fromPriceCents < q.minPrice) return false;
        if (q.maxPrice !== undefined && p.fromPriceCents > q.maxPrice) return false;
        return true;
      });

      const sorted = [...matched].sort(SORTERS[q.sort]);
      const start = (q.page - 1) * q.pageSize;
      const pagedItems = sorted.slice(start, start + q.pageSize).map(toSummary);

      return HttpResponse.json(
        paged(pagedItems, {
          page: q.page,
          pageSize: q.pageSize,
          total: sorted.length,
        }),
      );
    }),

    // Facets endpoint
    http.get(`${baseUrl}/products/facets`, ({ request }) => {
      const parsed = ProductQuery.safeParse(searchParamsToObject(new URL(request.url)));
      const q = parsed.success ? parsed.data : null;
      const matched = products.filter((p) => {
        if (q?.q && !p.name.toLowerCase().includes(q.q.toLowerCase())) return false;
        if (q?.category) {
          const parent = CATEGORY_PARENT_MAP.get(p.categorySlug);
          if (p.categorySlug !== q.category && parent !== q.category) return false;
        }
        return true;
      });

      const brandCounts = new Map<string, number>();
      for (const p of matched) {
        if (p.brand) brandCounts.set(p.brand, (brandCounts.get(p.brand) ?? 0) + 1);
      }
      const brands = [...brandCounts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

      const materialCounts = new Map<string, number>();
      for (const p of matched) {
        if (p.material) materialCounts.set(p.material, (materialCounts.get(p.material) ?? 0) + 1);
      }
      const materials = [...materialCounts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

      const priceRanges = PRICE_BUCKETS.map((bucket) => ({
        ...bucket,
        count: matched.filter(
          (p) =>
            p.fromPriceCents >= bucket.minCents &&
            (bucket.maxCents === null || p.fromPriceCents < bucket.maxCents),
        ).length,
      }));

      return HttpResponse.json(ok({ brands, materials, priceRanges }));
    }),

    // Single product detail
    http.get(`${baseUrl}/products/:slug`, ({ params }) => {
      const product = products.find((p) => p.slug === params.slug);
      return product
        ? HttpResponse.json(ok(product))
        : HttpResponse.json(fail("NOT_FOUND", "Product not found."), { status: 404 });
    }),

    ...createReviewHandlers(store),
    ...createMockApiHandlers(baseUrl, { products }),
    ...createStoreHandlers(store),
    ...createAuthHandlers(store),
    ...createCheckoutHandlers(store),
    ...createOrderHandlers(store),
    ...createAccountHandlers(store),
    ...createSettingsHandlers(store),
  ];
}

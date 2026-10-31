import { http, HttpResponse } from "msw";
import {
  AddCartItemInput,
  ERROR_HTTP_STATUS,
  MAX_LINE_QUANTITY,
  UpdateCartItemInput,
  ProductQuery,
  fail,
  ok,
  paged,
  type Cart,
  type CartLine,
  type ErrorCode,
  type ProductDetail,
  type ProductSort,
  type ProductSummary,
} from "@hp/contracts";
import { makeCart, makeCartLine, makeCategoryTree, sampleCatalog, toSummary } from "../factories";

// Contract-faithful mock of the public API, used by storefront/admin dev mode
// (via msw/browser) and by component tests (via msw/node) until the real
// endpoints pass their integration tests (blueprint Section 9, rule 2).

export type MockApiOptions = {
  products?: readonly ProductDetail[];
  shippingCents?: number;
};

const DEFAULT_SHIPPING_CENTS = 799;

const errorResponse = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  HttpResponse.json(fail(code, message, details), { status: ERROR_HTTP_STATUS[code] });

/** Repeated keys become arrays, single keys stay strings — same as Express's query parser. */
function searchParamsToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    out[key] = values.length === 1 ? values[0]! : values;
  }
  return out;
}

const SORTERS: Record<ProductSort, (a: ProductSummary, b: ProductSummary) => number> = {
  relevance: () => 0,
  newest: () => 0,
  price_asc: (a, b) => a.fromPriceCents - b.fromPriceCents,
  price_desc: (a, b) => b.fromPriceCents - a.fromPriceCents,
  popular: (a, b) => b.ratingCount - a.ratingCount,
};

/** child slug → parent slug, so a parent category also matches its subcategories (as the API does). */
const PARENT_OF: ReadonlyMap<string, string> = new Map(
  makeCategoryTree().flatMap((top) => top.children.map((child) => [child.slug, top.slug] as const)),
);

const PRICE_BUCKETS: readonly { minCents: number; maxCents: number | null }[] = [
  { minCents: 0, maxCents: 2_500 },
  { minCents: 2_500, maxCents: 5_000 },
  { minCents: 5_000, maxCents: 10_000 },
  { minCents: 10_000, maxCents: 20_000 },
  { minCents: 20_000, maxCents: null },
];

/** Facet filters (brand, material, price) are skipped when computing facets, as in the API. */
function matchesQuery(
  product: ProductDetail,
  summary: ProductSummary,
  q: ProductQuery,
  { facetFilters = true }: { facetFilters?: boolean } = {},
): boolean {
  if (q.q && !product.name.toLowerCase().includes(q.q.toLowerCase())) return false;
  if (
    q.category &&
    product.categorySlug !== q.category &&
    PARENT_OF.get(product.categorySlug) !== q.category
  ) {
    return false;
  }
  if (facetFilters && q.brand && !q.brand.includes(product.brand ?? "")) return false;
  if (facetFilters && q.material && !q.material.includes(product.material ?? "")) return false;
  if (q.inStock !== undefined && summary.inStock !== q.inStock) return false;
  if (
    q.inductionCompatible !== undefined &&
    (product.inductionCompatible === true) !== q.inductionCompatible
  ) {
    return false;
  }
  if (facetFilters && q.minPrice !== undefined && summary.fromPriceCents < q.minPrice) return false;
  if (facetFilters && q.maxPrice !== undefined && summary.fromPriceCents > q.maxPrice) return false;
  return true;
}

const countBy = (values: (string | null)[]) => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

export function createMockApiHandlers(baseUrl: string, options: MockApiOptions = {}) {
  const products = options.products ?? sampleCatalog();
  const variants = new Map(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, { product, variant }] as const),
    ),
  );

  // Per-handler-set state, replaced (never mutated) on each change.
  let cartLines: readonly CartLine[] = [];

  const currentCart = (): Cart =>
    makeCart(cartLines, {
      id: "cart_mock",
      shippingCents: cartLines.length > 0 ? (options.shippingCents ?? DEFAULT_SHIPPING_CENTS) : 0,
    });

  return [
    http.get(`${baseUrl}/products`, ({ request }) => {
      const parsed = ProductQuery.safeParse(searchParamsToObject(new URL(request.url)));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some filters are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      const q = parsed.data;
      const results = products
        .map((product) => ({ product, summary: toSummary(product) }))
        .filter(({ product, summary }) => matchesQuery(product, summary, q))
        .map(({ summary }) => summary)
        .sort(SORTERS[q.sort]);
      const start = (q.page - 1) * q.pageSize;
      return HttpResponse.json(
        paged(results.slice(start, start + q.pageSize), {
          page: q.page,
          pageSize: q.pageSize,
          total: results.length,
        }),
      );
    }),

    http.get(`${baseUrl}/products/facets`, ({ request }) => {
      const parsed = ProductQuery.safeParse(searchParamsToObject(new URL(request.url)));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some filters are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      const matching = products
        .map((product) => ({ product, summary: toSummary(product) }))
        .filter(({ product, summary }) =>
          matchesQuery(product, summary, parsed.data, { facetFilters: false }),
        );
      return HttpResponse.json(
        ok({
          brands: countBy(matching.map(({ product }) => product.brand)),
          materials: countBy(matching.map(({ product }) => product.material)),
          priceRanges: PRICE_BUCKETS.map((bucket) => ({
            ...bucket,
            count: matching.filter(
              ({ summary }) =>
                summary.fromPriceCents >= bucket.minCents &&
                (bucket.maxCents === null || summary.fromPriceCents < bucket.maxCents),
            ).length,
          })),
        }),
      );
    }),

    http.get(`${baseUrl}/products/:slug`, ({ params }) => {
      const product = products.find((p) => p.slug === params.slug);
      return product
        ? HttpResponse.json(ok(product))
        : errorResponse("NOT_FOUND", "Product not found.");
    }),

    http.get(`${baseUrl}/categories`, () => HttpResponse.json(ok(makeCategoryTree()))),

    http.get(`${baseUrl}/cart`, () => HttpResponse.json(ok(currentCart()))),

    http.post(`${baseUrl}/cart/items`, async ({ request }) => {
      const parsed = AddCartItemInput.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      const entry = variants.get(parsed.data.variantId);
      if (!entry) return errorResponse("NOT_FOUND", "That item is no longer available.");

      const { product, variant } = entry;
      const existing = cartLines.find((line) => line.variantId === variant.id);
      const quantity = (existing?.quantity ?? 0) + parsed.data.quantity;

      if (quantity > variant.stockAvailable) {
        return errorResponse(
          "OUT_OF_STOCK",
          `Only ${variant.stockAvailable} left of ${product.name}.`,
          {
            variantId: variant.id,
            available: variant.stockAvailable,
          },
        );
      }
      if (quantity > MAX_LINE_QUANTITY) {
        return errorResponse("VALIDATION_ERROR", `You can add up to ${MAX_LINE_QUANTITY}.`);
      }

      const line = makeCartLine({
        id: existing?.id ?? `line_${variant.id}`,
        variantId: variant.id,
        productSlug: product.slug,
        productName: product.name,
        variantName: variant.name,
        sku: variant.sku,
        thumbnailUrl: product.images[0]?.url ?? null,
        unitPriceCents: variant.priceCents,
        quantity,
        stockAvailable: variant.stockAvailable,
      });
      cartLines = existing
        ? cartLines.map((l) => (l.id === existing.id ? line : l))
        : [...cartLines, line];

      return HttpResponse.json(ok(currentCart()));
    }),

    http.patch(`${baseUrl}/cart/items/:itemId`, async ({ params, request }) => {
      const parsed = UpdateCartItemInput.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      const line = cartLines.find((l) => l.id === params.itemId);
      const entry = line ? variants.get(line.variantId) : undefined;
      if (!line || !entry) return errorResponse("NOT_FOUND", "That item isn't in your cart.");

      const { product, variant } = entry;
      if (parsed.data.quantity > variant.stockAvailable) {
        return errorResponse(
          "OUT_OF_STOCK",
          `Only ${variant.stockAvailable} left of ${product.name}.`,
          { variantId: variant.id, available: variant.stockAvailable },
        );
      }
      const updated = makeCartLine({
        ...line,
        quantity: parsed.data.quantity,
        lineTotalCents: line.unitPriceCents * parsed.data.quantity,
      });
      cartLines = cartLines.map((l) => (l.id === line.id ? updated : l));
      return HttpResponse.json(ok(currentCart()));
    }),

    http.delete(`${baseUrl}/cart/items/:itemId`, ({ params }) => {
      if (!cartLines.some((l) => l.id === params.itemId)) {
        return errorResponse("NOT_FOUND", "That item isn't in your cart.");
      }
      cartLines = cartLines.filter((l) => l.id !== params.itemId);
      return HttpResponse.json(ok(currentCart()));
    }),
  ];
}

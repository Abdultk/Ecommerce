import { ProductQuery } from "@hp/contracts";

/** Shape of Next.js `searchParams` once awaited. */
export type SearchParamsInput = Record<string, string | string[] | undefined>;

export const DEFAULT_QUERY: ProductQuery = Object.freeze(ProductQuery.parse({}));

/** Stable key order keeps generated URLs (and therefore caches) deterministic. */
const KEY_ORDER = [
  "q",
  "category",
  "brand",
  "material",
  "minPrice",
  "maxPrice",
  "inStock",
  "inductionCompatible",
  "sort",
  "page",
  "pageSize",
] as const satisfies readonly (keyof ProductQuery)[];

type QueryKey = (typeof KEY_ORDER)[number];

/** The URL is the state: invalid params fall back to the defaults instead of erroring. */
export function parseProductQuery(params: SearchParamsInput): ProductQuery {
  const parsed = ProductQuery.safeParse(params);
  return parsed.success ? parsed.data : { ...DEFAULT_QUERY };
}

function appendValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) params.append(key, String(item));
    return;
  }
  params.append(key, String(value));
}

/** Full query string for the API, including defaults. */
export function toApiQueryString(query: ProductQuery): string {
  const params = new URLSearchParams();
  for (const key of KEY_ORDER) appendValue(params, key, query[key]);
  return params.toString();
}

function isDefault(key: QueryKey, value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return key in DEFAULT_QUERY && DEFAULT_QUERY[key] === value;
}

type HrefOptions = { omitCategory?: boolean };

/**
 * Builds a storefront listing URL from the current query plus a patch. Defaults are
 * dropped so canonical URLs stay clean, and any filter change returns to page 1.
 */
export function buildListingHref(
  basePath: string,
  current: ProductQuery,
  patch: Partial<ProductQuery> = {},
  options: HrefOptions = {},
): string {
  const next: ProductQuery = { ...current, ...patch, page: patch.page ?? 1 };
  const params = new URLSearchParams();
  for (const key of KEY_ORDER) {
    if (options.omitCategory && key === "category") continue;
    if (isDefault(key, next[key])) continue;
    appendValue(params, key, next[key]);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Number of narrowing filters (not search, sort or paging), for the mobile "Filters (n)" badge. */
export function countActiveFilters(query: ProductQuery): number {
  return (
    (query.brand?.length ?? 0) +
    (query.material?.length ?? 0) +
    (query.minPrice === undefined ? 0 : 1) +
    (query.maxPrice === undefined ? 0 : 1) +
    (query.inStock === undefined ? 0 : 1) +
    (query.inductionCompatible === undefined ? 0 : 1)
  );
}

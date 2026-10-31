import type { MetadataRoute } from "next";
import type { ProductSummary } from "@hp/contracts";
import { getCategories, getProducts, orFallback } from "./catalog";
import { flattenCategories } from "./category-tree";
import type { CatalogApi } from "./internal-api";
import { SITE_URL } from "./env";
import { DEFAULT_QUERY } from "./query";

export type SitemapOptions = { pageSize?: number; maxPages?: number };

const PAGE_SIZE = 100;
/** Safety cap: 50 pages × 100 = 5,000 products, well under the 50k-URL sitemap limit. */
const MAX_PAGES = 50;

/** Remaining pages after the first. A failure here propagates: a partial sitemap would
 *  drop live products, so ISR should keep serving the last complete one instead. */
async function laterPages(
  api: CatalogApi,
  pageSize: number,
  lastPage: number,
  page = 2,
  acc: readonly ProductSummary[] = [],
): Promise<ProductSummary[]> {
  if (page > lastPage) return [...acc];
  const { products } = await getProducts(api, { ...DEFAULT_QUERY, pageSize, page });
  if (products.length === 0) return [...acc];
  return laterPages(api, pageSize, lastPage, page + 1, [...acc, ...products]);
}

/**
 * Every active product. If even the first page fails (API down, e.g. during a build) the
 * sitemap still lists the static pages; a failure on a later page throws (see above).
 */
async function allProducts(api: CatalogApi, pageSize: number, maxPages: number) {
  const first = await orFallback(
    getProducts(api, { ...DEFAULT_QUERY, pageSize, page: 1 }),
    null,
    "sitemap products",
  );
  if (!first) return [];
  const lastPage = Math.min(first.meta.totalPages, maxPages);
  return [...first.products, ...(await laterPages(api, pageSize, lastPage))];
}

/** Static pages, every category and every active product. Canonical URLs only (no filters). */
export async function buildSitemap(
  api: CatalogApi,
  { pageSize = PAGE_SIZE, maxPages = MAX_PAGES }: SitemapOptions = {},
): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([
    orFallback(getCategories(api), [], "sitemap categories"),
    allProducts(api, pageSize, maxPages),
  ]);
  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/shop`, changeFrequency: "daily", priority: 0.9 },
    ...flattenCategories(categories).map((c) => ({
      url: `${SITE_URL}/c/${c.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((p) => ({
      url: `${SITE_URL}/p/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

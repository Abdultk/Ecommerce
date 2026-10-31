import { z } from "zod";
import {
  Category,
  type PageMeta,
  ProductDetail,
  ProductFacets,
  ProductSummary,
  type ProductQuery,
} from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import type { CatalogApi } from "./internal-api";
import { toApiQueryString } from "./query";

// Server-side catalog reads. Each function takes the client so tests can inject one.

export type ProductPage = { products: ProductSummary[]; meta: PageMeta };

const EMPTY_META = (query: ProductQuery): PageMeta => ({
  page: query.page,
  pageSize: query.pageSize,
  total: 0,
  totalPages: 0,
});

export async function getProducts(api: CatalogApi, query: ProductQuery): Promise<ProductPage> {
  const { data, meta } = await api.get(
    `/products?${toApiQueryString(query)}`,
    z.array(ProductSummary),
  );
  return {
    products: data,
    meta: meta ?? { ...EMPTY_META(query), total: data.length, totalPages: data.length ? 1 : 0 },
  };
}

/** Product detail, or null on a 404. Every other failure is rethrown for error.tsx. */
export async function getProduct(api: CatalogApi, slug: string): Promise<ProductDetail | null> {
  try {
    return (await api.get(`/products/${encodeURIComponent(slug)}`, ProductDetail)).data;
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return null;
    throw err;
  }
}

export async function getCategories(api: CatalogApi): Promise<Category[]> {
  return (await api.get("/categories", z.array(Category))).data;
}

/** Facets are an enhancement: when they are unavailable the sidebar hides those groups. */
export async function getFacets(
  api: CatalogApi,
  query: ProductQuery,
): Promise<ProductFacets | null> {
  try {
    return (await api.get(`/products/facets?${toApiQueryString(query)}`, ProductFacets)).data;
  } catch {
    return null;
  }
}

/**
 * For chrome (header, home rails, sitemap) a failed read must not take the page down.
 * Returns the fallback instead, and reports the failure on the server log.
 */
export async function orFallback<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[catalog] ${label} unavailable: ${reason}`);
    return fallback;
  }
}

export { EMPTY_META };

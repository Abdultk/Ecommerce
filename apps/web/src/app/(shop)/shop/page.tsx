import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ListingView } from "@/components/catalog/ListingView";
import { serverApi } from "@/lib/server-api";
import { EMPTY_META, getFacets, getProducts, orFallback } from "@/lib/catalog";
import { parseProductQuery, type SearchParamsInput } from "@/lib/query";
import { pageMetadata } from "@/lib/seo";

type Props = { searchParams: Promise<SearchParamsInput> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = parseProductQuery(await searchParams);
  const t = await getTranslations("Catalog.shop");
  // Canonical drops filter params so filtered views don't compete in search.
  const base = pageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/shop",
  });
  // Search result pages are thin, user-driven content: crawlable links, but not indexed.
  return query.q
    ? { ...base, title: t("searchTitle", { q: query.q }), robots: { index: false, follow: true } }
    : base;
}

export default async function ShopPage({ searchParams }: Props) {
  // The URL is the state; invalid params fall back to the defaults.
  const query = parseProductQuery(await searchParams);
  const t = await getTranslations("Catalog.shop");
  const nav = await getTranslations("Nav");
  const emptyPage = { products: [], meta: EMPTY_META(query) };
  const [result, facets] = await Promise.all([
    orFallback(getProducts(serverApi, query), emptyPage, "shop products"),
    getFacets(serverApi, query),
  ]);

  return (
    <ListingView
      eyebrow={t("eyebrow")}
      heading={query.q ? t("resultsFor", { q: query.q }) : nav("shopAll")}
      basePath="/shop"
      query={query}
      result={result}
      facets={facets}
    />
  );
}

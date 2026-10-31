import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ProductQuery } from "@hp/contracts";
import {
  ByPurpose,
  CategoryTiles,
  Craft,
  Hero,
  pickHeroProducts,
  ProductRail,
  Spotlight,
  TrustStrip,
} from "@/components/home/HomeSections";
import { JsonLd } from "@/components/seo/JsonLd";
import { serverApi } from "@/lib/server-api";
import { EMPTY_META, getCategories, getProducts, orFallback } from "@/lib/catalog";
import { SITE_URL } from "@/lib/env";
import { organizationJsonLd, websiteJsonLd } from "@/lib/json-ld";
import { getNonce } from "@/lib/nonce";
import { DEFAULT_QUERY } from "@/lib/query";
import { pageMetadata } from "@/lib/seo";
import { loadStoreConfig } from "@/lib/store-config-server";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Home");
  return {
    ...pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: "/" }),
    // The home page uses the full brand title, not the "%s | PAISLEY art" template.
    title: { absolute: t("metaTitle") },
  };
}

const BEST_SELLERS = { ...DEFAULT_QUERY, sort: "popular" as const, pageSize: 4 };
const NEW_ARRIVALS = { ...DEFAULT_QUERY, sort: "newest" as const, pageSize: 4 };
// Real products whose photographs illustrate the hero and the category tiles.
const PHOTO_POOL = { ...DEFAULT_QUERY, sort: "popular" as const, pageSize: 100 };

export default async function HomePage() {
  const t = await getTranslations("Home");
  const emptyPage = (query: ProductQuery) => ({ products: [], meta: EMPTY_META(query) });
  const [categories, bestSellers, newArrivals, photoPool, config, nonce] = await Promise.all([
    orFallback(getCategories(serverApi), [], "categories"),
    orFallback(getProducts(serverApi, BEST_SELLERS), emptyPage(BEST_SELLERS), "best sellers"),
    orFallback(getProducts(serverApi, NEW_ARRIVALS), emptyPage(NEW_ARRIVALS), "new arrivals"),
    orFallback(getProducts(serverApi, PHOTO_POOL), emptyPage(PHOTO_POOL), "photo pool"),
    loadStoreConfig(),
    getNonce(),
  ]);
  const [spotlight] = bestSellers.products;

  return (
    <>
      <JsonLd data={[organizationJsonLd(SITE_URL), websiteJsonLd(SITE_URL)]} nonce={nonce} />
      <Hero products={pickHeroProducts(photoPool.products, 2, spotlight?.slug)} config={config} />
      <TrustStrip config={config} />
      <CategoryTiles categories={categories} products={photoPool.products} />
      <ProductRail
        id="best-heading"
        title={t("bestSellers")}
        href="/shop?sort=popular"
        linkLabel={t("viewAllBest")}
        products={bestSellers.products}
        emptyText={t("bestEmpty")}
      />
      {spotlight ? <Spotlight product={spotlight} config={config} /> : null}
      <Craft />
      <ByPurpose categories={categories} />
      <ProductRail
        id="new-heading"
        title={t("newArrivals")}
        href="/shop?sort=newest"
        linkLabel={t("seeNew")}
        products={newArrivals.products}
        emptyText={t("newEmpty")}
      />
    </>
  );
}

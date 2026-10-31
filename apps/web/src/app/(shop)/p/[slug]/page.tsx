import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatMoney } from "@hp/contracts";
import { intlLocale, type Locale } from "@/i18n/config";
import { WishlistButton } from "@/components/account/WishlistButton";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { Rating } from "@/components/catalog/Rating";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Gallery } from "@/components/product/Gallery";
import { ProductPurchase } from "@/components/product/ProductPurchase";
import { Reviews } from "@/components/product/Reviews";
import { SpecsTable } from "@/components/product/SpecsTable";
import { StickyBuyBar } from "@/components/product/StickyBuyBar";
import { TrustBadges } from "@/components/ui/TrustBadges";
import { JsonLd } from "@/components/seo/JsonLd";
import { PHOTO_CREDITS } from "@/content/photo-credits";
import { serverApi } from "@/lib/server-api";
import { EMPTY_META, getCategories, getProduct, getProducts, orFallback } from "@/lib/catalog";
import { findCategory } from "@/lib/category-tree";
import { SITE_URL } from "@/lib/env";
import { breadcrumbJsonLd, productJsonLd, stripTags } from "@/lib/json-ld";
import { getNonce } from "@/lib/nonce";
import { paymentMethodNames } from "@/lib/payment-choices";
import { DEFAULT_QUERY } from "@/lib/query";
import { sanitizeProductHtml } from "@/lib/sanitize";
import { pageMetadata } from "@/lib/seo";
import { loadStoreConfig } from "@/lib/store-config-server";

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

const RELATED_COUNT = 4;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // getProduct returns null only on a 404; other failures surface in the page render.
  const product = await getProduct(serverApi, (await params).slug).catch(() => null);
  if (!product) return {};
  return pageMetadata({
    title: product.name,
    description: stripTags(product.description).slice(0, 155),
    path: `/p/${product.slug}`,
    images: [...product.images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ url: i.url, alt: i.alt || product.name })),
  });
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  // notFound() only on a 404 ApiClientError; any other failure goes to error.tsx.
  const [product, categories, nonce, storeConfig] = await Promise.all([
    getProduct(serverApi, slug),
    orFallback(getCategories(serverApi), [], "categories"),
    getNonce(),
    loadStoreConfig(),
  ]);
  if (!product) notFound();
  const t = await getTranslations("Product");
  const header = await getTranslations("Header");
  const locale = (await getLocale()) as Locale;

  const relatedQuery = {
    ...DEFAULT_QUERY,
    category: product.categorySlug,
    pageSize: RELATED_COUNT + 1,
  };
  const related = await orFallback(
    getProducts(serverApi, relatedQuery),
    { products: [], meta: EMPTY_META(relatedQuery) },
    "related products",
  );
  const alsoLike = related.products.filter((p) => p.id !== product.id).slice(0, RELATED_COUNT);

  const match = findCategory(categories, product.categorySlug);
  const crumbs = [
    { name: t("home"), href: "/" },
    ...(match?.parent ? [{ name: match.parent.name, href: `/c/${match.parent.slug}` }] : []),
    ...(match ? [{ name: match.category.name, href: `/c/${match.category.slug}` }] : []),
    { name: product.name, href: `/p/${product.slug}` },
  ];
  const url = `${SITE_URL}/p/${product.slug}`;
  const jsonLd = [
    productJsonLd(product, url, storeConfig.currency),
    breadcrumbJsonLd(crumbs.map((c) => ({ name: c.name, url: `${SITE_URL}${c.href}` }))),
  ];
  // Delivery and payment come from the store's own settings; nothing is promised beyond them.
  const threshold = storeConfig.freeShippingThresholdCents;
  const methods = new Intl.ListFormat(intlLocale(locale), { type: "disjunction" }).format(
    paymentMethodNames(storeConfig, (m) => t(`method.${m}`)),
  );
  const shippingFacts = [
    threshold === null
      ? null
      : header("freeShippingOver", { amount: formatMoney(threshold, storeConfig.currency) }),
    header("deliveryAcrossOman"),
    t("payBy", { methods }),
  ].filter((fact): fact is string => Boolean(fact));
  const fromPrice = Math.min(...product.variants.map((v) => v.priceCents));
  const credit = PHOTO_CREDITS.find((c) => c.slug === product.slug);

  return (
    <article className="mx-auto max-w-7xl px-4 pb-24 pt-6">
      <JsonLd data={jsonLd} nonce={nonce} />
      <Breadcrumbs items={crumbs} />

      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Gallery images={product.images} productName={product.name} />
          {credit ? (
            <p className="mt-3 text-sm text-smoke">
              {t("photoBy", { creator: credit.creator, license: credit.license.toUpperCase() })}{" "}
              <Link href="/credits" className="underline">
                {t("credits")}
              </Link>
            </p>
          ) : null}
        </div>

        <div className="space-y-8 lg:pt-2">
          <header className="space-y-3">
            {product.brand ? <p className="font-medium text-smoke">{product.brand}</p> : null}
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-[length:var(--text-display)]">{product.name}</h1>
              <WishlistButton product={product} className="shrink-0" />
            </div>
            <a href="#reviews" className="inline-flex transition-opacity hover:opacity-80">
              <Rating average={product.ratingAvg} reviews={product.ratingCount} size="md" />
            </a>
          </header>

          <ProductPurchase product={product} />

          <TrustBadges />

          <ul className="space-y-1 text-sm font-medium text-smoke">
            {shippingFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>

          {/* Sanitized by the API on save and again here (server-only), as defence in depth. */}
          <div
            className="prose-kitchen text-smoke"
            dangerouslySetInnerHTML={{ __html: sanitizeProductHtml(product.description) }}
          />

          <SpecsTable product={product} />
        </div>
      </div>

      {alsoLike.length > 0 ? (
        <section aria-labelledby="related-heading" className="mt-24">
          <h2 id="related-heading" className="reveal mb-8 text-[length:var(--text-display)]">
            {t("related")}
          </h2>
          <div className="reveal">
            <ProductGrid products={alsoLike} />
          </div>
        </section>
      ) : null}

      <div className="mt-20 max-w-3xl">
        <Reviews slug={product.slug} />
      </div>

      <StickyBuyBar name={product.name} fromPriceCents={fromPrice} />
    </article>
  );
}

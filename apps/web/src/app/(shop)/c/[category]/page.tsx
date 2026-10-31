import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ListingView } from "@/components/catalog/ListingView";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { serverApi } from "@/lib/server-api";
import { EMPTY_META, getCategories, getFacets, getProducts, orFallback } from "@/lib/catalog";
import { findCategory } from "@/lib/category-tree";
import { SITE_URL } from "@/lib/env";
import { breadcrumbJsonLd } from "@/lib/json-ld";
import { getNonce } from "@/lib/nonce";
import { parseProductQuery, type SearchParamsInput } from "@/lib/query";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 300;

type Props = { params: Promise<{ category: string }>; searchParams: Promise<SearchParamsInput> };

async function loadCategory(slug: string) {
  const tree = await orFallback(getCategories(serverApi), [], "categories");
  return findCategory(tree, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const match = await loadCategory(slug).catch(() => null);
  if (!match) return {};
  const t = await getTranslations("Catalog.category");
  // Canonical drops filter, sort and page params so filtered views don't compete in search.
  return pageMetadata({
    title: match.category.name,
    description: t("metaDescription", { name: match.category.name.toLowerCase() }),
    path: `/c/${match.category.slug}`,
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { category: slug } = await params;
  const match = await loadCategory(slug);
  if (!match) notFound();
  const t = await getTranslations("Catalog.category");
  const product = await getTranslations("Product");

  const { category, parent } = match;
  const query = { ...parseProductQuery(await searchParams), category: category.slug };
  const basePath = `/c/${category.slug}`;
  const emptyPage = { products: [], meta: EMPTY_META(query) };
  const [result, facets, nonce] = await Promise.all([
    orFallback(getProducts(serverApi, query), emptyPage, "category products"),
    getFacets(serverApi, query),
    getNonce(),
  ]);

  const crumbs = [
    { name: product("home"), href: "/" },
    ...(parent ? [{ name: parent.name, href: `/c/${parent.slug}` }] : []),
    { name: category.name, href: basePath },
  ];

  return (
    <ListingView
      eyebrow={parent ? parent.name : t("eyebrow")}
      heading={category.name}
      basePath={basePath}
      query={query}
      result={result}
      facets={facets}
      omitCategory
      breadcrumbs={
        <>
          <JsonLd
            data={breadcrumbJsonLd(
              crumbs.map((c) => ({ name: c.name, url: `${SITE_URL}${c.href}` })),
            )}
            nonce={nonce}
          />
          <Breadcrumbs items={crumbs} />
        </>
      }
      intro={
        category.children.length > 0 ? (
          <ul aria-label={t("collections", { name: category.name })} className="flex flex-wrap gap-2 pt-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/c/${child.slug}`}
                  className="inline-flex min-h-11 items-center rounded-full border-2 border-stroke bg-crust px-4 text-sm font-semibold hover:border-iron"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null
      }
    />
  );
}

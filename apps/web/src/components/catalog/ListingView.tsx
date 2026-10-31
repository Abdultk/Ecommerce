import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProductFacets, ProductQuery } from "@hp/contracts";
import { LazyAnimatedContent as AnimatedContent } from "@/components/fx/lazy";
import type { ProductPage } from "@/lib/catalog";
import { FilterRail } from "./FilterRail";
import { FilterSidebar } from "./FilterSidebar";
import { Pagination } from "./Pagination";
import { ProductGrid } from "./ProductGrid";
import { SortSelect } from "./SortSelect";

type Props = {
  heading: string;
  eyebrow: string;
  intro?: ReactNode;
  basePath: string;
  query: ProductQuery;
  result: ProductPage;
  facets: ProductFacets | null;
  omitCategory?: boolean;
  breadcrumbs?: ReactNode;
};

/** Shared layout for /shop and /c/[category]: header, filters, sort, grid, paging. */
export function ListingView({
  heading,
  eyebrow,
  intro,
  basePath,
  query,
  result,
  facets,
  omitCategory = false,
  breadcrumbs,
}: Props) {
  const t = useTranslations("Catalog.listing");
  const { products, meta } = result;

  return (
    <div className="mx-auto max-w-7xl px-4">
      <div className="space-y-3 pb-6 pt-8 md:pt-12">
        {breadcrumbs}
        <p className="stamp">{eyebrow}</p>
        <h1 className="text-[length:var(--text-display)]">{heading}</h1>
        {intro}
      </div>

      {/* Sticky Quick-Access Filter Rail */}
      <FilterRail
        basePath={basePath}
        query={query}
        facets={facets}
        omitCategory={omitCategory}
      />

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <FilterSidebar
          basePath={basePath}
          query={query}
          facets={facets}
          omitCategory={omitCategory}
        />

        <section aria-labelledby="results-heading" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <h2
              id="results-heading"
              className="font-sans text-sm font-semibold text-smoke"
              aria-live="polite"
            >
              {query.q
                ? t.rich("countFor", {
                    count: meta.total,
                    n: meta.total,
                    term: query.q,
                    hl: (chunks) => <span className="text-iron">{chunks}</span>,
                  })
                : t("count", { count: meta.total, n: meta.total })}
            </h2>
            <SortSelect basePath={basePath} query={query} omitCategory={omitCategory} />
          </div>

          {products.length > 0 ? (
            <AnimatedContent distance={28} duration={0.7} threshold={0.05}>
              <ProductGrid products={products} priorityCount={2} />
            </AnimatedContent>
          ) : (
            <div className="tile-bg grid place-items-center gap-3 rounded-sm px-6 py-16 text-center">
              <p className="font-display text-2xl">{t("empty")}</p>
              <p className="max-w-sm text-sm text-smoke">{t("emptyHint")}</p>
              <Link href={basePath} className="btn btn-iron">
                {t("clear")}
              </Link>
            </div>
          )}

          <Pagination
            basePath={basePath}
            query={query}
            totalPages={meta.totalPages}
            omitCategory={omitCategory}
          />
        </section>
      </div>
    </div>
  );
}

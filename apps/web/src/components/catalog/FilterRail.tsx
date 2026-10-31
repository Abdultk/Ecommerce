"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ProductFacets, ProductQuery } from "@hp/contracts";
import { FilterIcon } from "@/components/ui/Icons";
import { buildListingHref, countActiveFilters } from "@/lib/query";
import { FilterSidebar } from "./FilterSidebar";

interface FilterRailProps {
  basePath: string;
  query: ProductQuery;
  facets: ProductFacets | null;
  omitCategory?: boolean;
}

export function FilterRail({ basePath, query, facets, omitCategory = false }: FilterRailProps) {
  const t = useTranslations("Catalog.filters");
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const activeCount = countActiveFilters(query);

  const go = (patch: Partial<ProductQuery>) =>
    router.push(buildListingHref(basePath, query, patch, { omitCategory }), { scroll: false });

  const clearHref = buildListingHref(
    basePath,
    {
      ...query,
      brand: undefined,
      material: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      inStock: undefined,
      inductionCompatible: undefined,
    },
    {},
    { omitCategory },
  );

  return (
    <div className="sticky top-20 z-30 mb-6 lg:hidden rounded-[var(--radius-pan)] border border-line bg-flour/90 p-3 shadow-plate backdrop-blur-md transition-all">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Main Filter Drawer Trigger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            className="flex items-center gap-2 rounded-full border border-line bg-parchment px-4 py-2 text-xs font-semibold tracking-wide text-iron shadow-sm transition-all hover:border-forest hover:bg-flour"
          >
            <FilterIcon />
            <span>{t("allFilters")}</span>
            {activeCount > 0 ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-forest text-[11px] font-bold text-flour">
                {activeCount}
              </span>
            ) : null}
          </button>

          {/* Quick Pill: In Stock */}
          <button
            type="button"
            onClick={() => go({ inStock: query.inStock ? undefined : true })}
            aria-pressed={query.inStock === true}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-all ${
              query.inStock
                ? "bg-forest text-flour shadow-sm"
                : "border border-line bg-crust text-smoke hover:border-line hover:text-iron"
            }`}
          >
            {query.inStock ? <span>✓</span> : null}
            <span>{t("inStockOnly")}</span>
          </button>

        </div>

        {/* Right: Clear Filters Link */}
        {activeCount > 0 ? (
          <Link
            href={clearHref}
            className="link-underline text-xs font-semibold text-smoke hover:text-iron"
          >
            {t("clearAll")} ({activeCount})
          </Link>
        ) : null}
      </div>

      {/* Active Filter Badges Row */}
      {activeCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-smoke me-1">
            {t("activeFilters")}:
          </span>

          {query.inStock ? (
            <button
              type="button"
              onClick={() => go({ inStock: undefined })}
              aria-label={t("removeFilter", { filter: t("inStockOnly") })}
              className="group flex items-center gap-1.5 rounded-full bg-sage-wash px-2.5 py-1 text-xs text-forest hover:bg-danger-wash hover:text-danger transition-colors"
            >
              <span>{t("inStockOnly")}</span>
              <span className="text-[10px] opacity-70 group-hover:opacity-100">✕</span>
            </button>
          ) : null}

          {query.brand?.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() =>
                go({ brand: query.brand?.filter((item) => item !== b) })
              }
              aria-label={t("removeFilter", { filter: b })}
              className="group flex items-center gap-1.5 rounded-full bg-sage-wash px-2.5 py-1 text-xs text-forest hover:bg-danger-wash hover:text-danger transition-colors"
            >
              <span>{b}</span>
              <span className="text-[10px] opacity-70 group-hover:opacity-100">✕</span>
            </button>
          ))}

          {query.material?.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() =>
                go({ material: query.material?.filter((item) => item !== m) })
              }
              aria-label={t("removeFilter", { filter: m })}
              className="group flex items-center gap-1.5 rounded-full bg-sage-wash px-2.5 py-1 text-xs text-forest hover:bg-danger-wash hover:text-danger transition-colors"
            >
              <span>{m}</span>
              <span className="text-[10px] opacity-70 group-hover:opacity-100">✕</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Slide-Over Drawer for In-Depth Refinement */}
      {drawerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          id={drawerId}
          aria-label={t("refine")}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-50 flex justify-end bg-iron/60 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative h-full w-full max-w-md bg-flour p-6 shadow-lift overflow-y-auto animate-in slide-in-from-right"
          >
            <div className="flex items-center justify-between border-b border-line pb-4 mb-6">
              <div className="flex items-center gap-2">
                <FilterIcon />
                <h2 className="font-display text-2xl text-iron">{t("refine")}</h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-smoke hover:text-iron transition-colors"
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>

            <FilterSidebar
              basePath={basePath}
              query={query}
              facets={facets}
              omitCategory={omitCategory}
              embedded
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

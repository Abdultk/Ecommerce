"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { currencyExponent, type ProductFacets, type ProductQuery } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { minorToMajorInput, parseMajorAmount } from "@/lib/format";
import { buildListingHref, countActiveFilters } from "@/lib/query";

type Props = {
  basePath: string;
  query: ProductQuery;
  facets: ProductFacets | null;
  /** Category pages carry the category in the path, not the query string. */
  omitCategory?: boolean;
  /** Inside the filter drawer: always shown, with no page-sidebar behaviour. */
  embedded?: boolean;
};

type ListKey = "brand" | "material";

function toggle(list: readonly string[] | undefined, value: string): string[] {
  const current = list ?? [];
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

export function FilterSidebar({
  basePath,
  query,
  facets,
  omitCategory = false,
  embedded = false,
}: Props) {
  const t = useTranslations("Catalog.filters");
  const router = useRouter();
  const active = countActiveFilters(query);

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
    <aside
      aria-label={t("label")}
      className={embedded ? undefined : "hidden lg:sticky lg:top-28 lg:block lg:self-start"}
    >
      <div className="space-y-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl">{t("refine")}</h2>
          {active > 0 ? (
            <Link
              href={clearHref}
              className="link-underline inline-flex min-h-6 items-center text-sm font-semibold"
            >
              {t("clearAll")}
            </Link>
          ) : null}
        </div>

        <fieldset className="space-y-3 rounded-sm bg-crust p-4">
          <legend className="stamp mb-1">{t("availability")}</legend>
          <Toggle
            label={t("inStockOnly")}
            checked={query.inStock === true}
            onChange={(checked) => go({ inStock: checked ? true : undefined })}
          />
        </fieldset>

        {facets ? (
          <>
            <FacetGroup
              legend={t("brand")}
              listKey="brand"
              options={facets.brands}
              query={query}
              onToggle={go}
            />
            <FacetGroup
              legend={t("material")}
              listKey="material"
              options={facets.materials}
              query={query}
              onToggle={go}
            />
          </>
        ) : null}

        <PriceRange
          key={`${query.minPrice ?? ""}-${query.maxPrice ?? ""}`}
          minPrice={query.minPrice}
          maxPrice={query.maxPrice}
          onApply={(minPrice, maxPrice) => go({ minPrice, maxPrice })}
        />
      </div>
    </aside>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
      <input
        type="checkbox"
        className="size-5 accent-ember"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

type FacetGroupProps = {
  legend: string;
  listKey: ListKey;
  options: ProductFacets["brands"];
  query: ProductQuery;
  onToggle: (patch: Partial<ProductQuery>) => void;
};

function FacetGroup({ legend, listKey, options, query, onToggle }: FacetGroupProps) {
  const t = useTranslations("Catalog.filters");
  if (options.length === 0) return null;
  const selected = query[listKey] ?? [];
  return (
    <fieldset className="space-y-1 rounded-sm bg-crust p-4">
      <legend className="stamp mb-1">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
        >
          <input
            type="checkbox"
            className="size-5 accent-ember"
            checked={selected.includes(option.value)}
            onChange={() => onToggle({ [listKey]: toggle(query[listKey], option.value) })}
          />
          <span className="flex-1">{option.label ?? option.value}</span>
          <span className="font-mono text-xs text-smoke" aria-label={t("products", { count: option.count, n: option.count })}>
            {option.count}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

type PriceRangeProps = {
  minPrice: number | undefined;
  maxPrice: number | undefined;
  onApply: (min: number | undefined, max: number | undefined) => void;
};

function PriceRange({ minPrice, maxPrice, onApply }: PriceRangeProps) {
  const t = useTranslations("Catalog.filters");
  const { currency } = useStoreConfig();
  const [min, setMin] = useState(minorToMajorInput(minPrice, currency));
  const [max, setMax] = useState(minorToMajorInput(maxPrice, currency));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const minId = useId();
  const maxId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const minCents = parseMajorAmount(min, currency);
    const maxCents = parseMajorAmount(max, currency);
    if (minCents === "invalid" || maxCents === "invalid") {
      const decimals = currencyExponent(currency);
      setError(t("errorFormat", { currency, decimals }));
      return;
    }
    if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) {
      setError(t("errorOrder"));
      return;
    }
    setError(null);
    onApply(minCents, maxCents);
  }

  const describedBy = error ? errorId : undefined;
  return (
    <form onSubmit={handleSubmit} className="rounded-sm bg-crust p-4" noValidate>
      <fieldset>
        <legend className="stamp mb-3">{t("price")}</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={minId} className="mb-1 block text-xs font-semibold text-smoke">
              {t("minPrice", { currency })}
            </label>
            <input
              id={minId}
              inputMode="decimal"
              className="field"
              value={min}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => setMin(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={maxId} className="mb-1 block text-xs font-semibold text-smoke">
              {t("maxPrice", { currency })}
            </label>
            <input
              id={maxId}
              inputMode="decimal"
              className="field"
              value={max}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
        </div>
        {error ? (
          <p id={errorId} className="mt-2 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-iron mt-3 w-full">
          {t("apply")}
        </button>
      </fieldset>
    </form>
  );
}

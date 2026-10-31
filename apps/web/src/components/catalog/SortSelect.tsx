"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProductSort, type ProductQuery } from "@hp/contracts";
import { buildListingHref } from "@/lib/query";

type Props = { basePath: string; query: ProductQuery; omitCategory?: boolean };

export function SortSelect({ basePath, query, omitCategory = false }: Props) {
  const t = useTranslations("Catalog.sort");
  const router = useRouter();
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-smoke">
        {t("label")}
      </label>
      <select
        id={id}
        className="field !w-auto !min-h-10 !py-1.5 text-sm font-semibold"
        value={query.sort}
        onChange={(e) => {
          const sort = ProductSort.safeParse(e.target.value);
          if (!sort.success) return;
          router.push(buildListingHref(basePath, query, { sort: sort.data }, { omitCategory }), {
            scroll: false,
          });
        }}
      >
        {ProductSort.options.map((option) => (
          <option key={option} value={option}>
            {t(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

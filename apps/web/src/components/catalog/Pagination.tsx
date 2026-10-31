import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProductQuery } from "@hp/contracts";
import { buildListingHref } from "@/lib/query";

type Props = { basePath: string; query: ProductQuery; totalPages: number; omitCategory?: boolean };

const WINDOW = 2;

/** Page numbers around the current page, with the first and last always present. */
function pageList(current: number, total: number): (number | "gap")[] {
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= total; p++) {
    const near = Math.abs(p - current) <= WINDOW;
    if (p === 1 || p === total || near) pages.push(p);
    else if (pages[pages.length - 1] !== "gap") pages.push("gap");
  }
  return pages;
}

export function Pagination({ basePath, query, totalPages, omitCategory = false }: Props) {
  const t = useTranslations("Catalog.pagination");
  if (totalPages <= 1) return null;
  const current = Math.min(query.page, totalPages);
  const href = (page: number) => buildListingHref(basePath, query, { page }, { omitCategory });
  const item = "grid min-h-11 min-w-11 place-items-center rounded-full px-3 text-sm font-semibold";

  return (
    <nav
      aria-label={t("label")}
      className="mt-10 flex flex-wrap items-center justify-center gap-1.5"
    >
      {current > 1 ? (
        <Link href={href(current - 1)} className={`${item} hover:bg-parchment`} rel="prev">
          {t("previous")}
        </Link>
      ) : null}
      {pageList(current, totalPages).map((page, index) =>
        page === "gap" ? (
          <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-smoke">
            …
          </span>
        ) : (
          <Link
            key={page}
            href={href(page)}
            aria-label={t("page", { page })}
            aria-current={page === current ? "page" : undefined}
            className={`${item} ${page === current ? "bg-iron text-crust" : "hover:bg-parchment"}`}
          >
            {page}
          </Link>
        ),
      )}
      {current < totalPages ? (
        <Link href={href(current + 1)} className={`${item} hover:bg-parchment`} rel="next">
          {t("next")}
        </Link>
      ) : null}
    </nav>
  );
}

import Link from "next/link";
import { useTranslations } from "next-intl";

export type Crumb = { name: string; href: string };

/** Visible trail; the last crumb is the current page. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const t = useTranslations("Catalog");
  return (
    <nav aria-label={t("breadcrumb")} className="text-sm text-smoke">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={crumb.href} className="flex items-center gap-1.5">
              {isLast ? (
                <span aria-current="page" className="font-semibold text-iron">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link
                    href={crumb.href}
                    className="link-underline inline-flex min-h-6 items-center"
                  >
                    {crumb.name}
                  </Link>
                  <span aria-hidden="true">/</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

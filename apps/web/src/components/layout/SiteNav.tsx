import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Category } from "@hp/contracts";
import { ArrowIcon } from "@/components/ui/Icons";
import { PieceArt, pieceFor } from "@/components/ui/PieceArt";
import { NavLink } from "./NavLink";

const TRIGGER =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-[0.9375rem] font-semibold text-iron transition-colors duration-200 hover:text-forest";

/**
 * Desktop category navigation. Each category with sub-categories opens a mega panel on hover
 * or keyboard focus (focus-within keeps every sub-link reachable by Tab). Phones use the
 * slide-in menu instead, so this bar is hidden below the large breakpoint.
 */
export function SiteNav({ categories }: { categories: readonly Category[] }) {
  const t = useTranslations("Nav");
  return (
    <nav aria-label={t("label")} className="hidden xl:order-last xl:block xl:w-full">
      <ul className="flex items-center gap-1">
        <li>
          <NavLink href="/shop" prefix={false} className={TRIGGER}>
            {t("shopAll")}
          </NavLink>
        </li>
        {categories.map((category) => (
          <li key={category.id} className="group">
            <NavLink href={`/c/${category.slug}`} className={TRIGGER}>
              {category.name}
            </NavLink>
            {category.children.length > 0 ? (
              <div className="invisible absolute inset-x-0 top-full z-40 -translate-y-1 border-t border-line bg-flour opacity-0 shadow-[var(--shadow-lift)] transition duration-300 ease-[var(--ease-sear)] group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-10 px-6 py-8">
                  <div>
                    <p className="mb-3 font-display text-3xl">{category.name}</p>
                    <ul className="grid grid-cols-2 gap-x-10 gap-y-1">
                      {category.children.map((child) => (
                        <li key={child.id}>
                          <Link
                            href={`/c/${child.slug}`}
                            className="flex min-h-11 items-center justify-between gap-4 rounded-md px-3 font-medium transition-colors duration-200 hover:bg-parchment"
                          >
                            {child.name}
                            <ArrowIcon className="size-4 text-copper" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={`/c/${category.slug}`}
                      className="link-underline mt-4 inline-flex font-semibold"
                    >
                      {t("shopAllIn", { category: category.name.toLowerCase() })}
                    </Link>
                  </div>
                  <div
                    aria-hidden="true"
                    className="grid h-44 w-72 place-items-center rounded-[var(--radius-pan)] bg-sage-wash"
                  >
                    <PieceArt piece={pieceFor(category.slug)} className="h-28 w-28" />
                  </div>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

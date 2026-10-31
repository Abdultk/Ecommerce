import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ProductQuery } from "@hp/contracts";
import { EMPTY_META, getProducts, orFallback } from "@/lib/catalog";
import { DEFAULT_QUERY } from "@/lib/query";
import { serverApi } from "@/lib/server-api";

const FEATURED: ProductQuery = { ...DEFAULT_QUERY, sort: "popular", pageSize: 12 };

/**
 * Sign-in, register and password pages: a real product photograph beside the form on large
 * screens, a banner above it on phones and tablets. The picture is the shop's own best-selling
 * product that has a photograph; with no products yet the panel is a plain tinted block.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("Auth");
  const page = await orFallback(
    getProducts(serverApi, FEATURED),
    { products: [], meta: EMPTY_META(FEATURED) },
    "auth photo",
  );
  const featured = page.products.find((p) => p.thumbnailUrl) ?? null;

  return (
    <div className="grid min-h-[calc(100dvh-8rem)] lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-iron lg:block">
        {featured?.thumbnailUrl ? (
          <Image
            src={featured.thumbnailUrl}
            alt=""
            fill
            priority
            sizes="50vw"
            className="object-cover"
          />
        ) : null}
        <div className="absolute inset-0 bg-iron/35" aria-hidden="true" />
        <div className="relative flex h-full flex-col justify-end gap-6 p-12 text-flour xl:p-16">
          <p className="max-w-md font-display text-5xl leading-[1.05]">{t("tagline")}</p>
          {featured ? (
            <Link
              href={`/p/${featured.slug}`}
              className="link-underline inline-flex min-h-11 w-fit items-center text-sm font-semibold"
            >
              {t("shopThis", { name: featured.name })}
            </Link>
          ) : null}
        </div>
      </aside>

      <div className="flex flex-col">
        {featured?.thumbnailUrl ? (
          <div className="relative aspect-[16/7] w-full overflow-hidden bg-iron lg:hidden">
            <Image
              src={featured.thumbnailUrl}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-iron/35" aria-hidden="true" />
            <p className="absolute inset-x-0 bottom-0 p-5 font-display text-3xl leading-tight text-flour sm:p-8 sm:text-4xl">
              {t("tagline")}
            </p>
          </div>
        ) : (
          <p className="px-5 pt-10 font-display text-3xl leading-tight text-enamel sm:px-8 lg:hidden">
            {t("tagline")}
          </p>
        )}
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-12 lg:py-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CartContents } from "@/components/cart/CartContents";
import { ProductRail } from "@/components/home/HomeSections";
import { serverApi } from "@/lib/server-api";
import { DEFAULT_QUERY } from "@/lib/query";
import { EMPTY_META, getProducts, orFallback } from "@/lib/catalog";

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Cart");
  return { title: t("drawerTitle"), robots: { index: false } };
}

export default async function CartPage() {
  const t = await getTranslations("Cart");
  const query = { ...DEFAULT_QUERY, pageSize: 4, sort: "popular" as const };
  const popular = await orFallback(
    getProducts(serverApi, query),
    { products: [], meta: EMPTY_META(query) },
    "popular cart upsells",
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 pb-16">
      <p className="stamp">{t("pageKicker")}</p>
      <h1 className="mb-8 mt-2 text-[length:var(--text-display)]">{t("drawerTitle")}</h1>
      <CartContents variant="page" />

      {popular.products.length > 0 && (
        <div className="mt-20 border-t border-line pt-12">
          <ProductRail
            id="cart-upsells"
            title={t("recommendationsHeading")}
            href="/shop?sort=popular"
            linkLabel={t("recommendationsLink")}
            products={popular.products}
            emptyText=""
          />
        </div>
      )}
    </div>
  );
}


"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { useWishlist, useWishlistProducts } from "@/lib/account";
import { errorMessage } from "@/lib/orders";

export function WishlistView() {
  const t = useTranslations("Account.wishlist");
  const browse = useTranslations("Checkout");
  const wishlist = useWishlist();
  const ids = wishlist.data?.map((item) => item.productId);
  const products = useWishlistProducts(ids);

  if (wishlist.isPending) return <div aria-busy="true" className="skeleton h-64" />;
  const error = wishlist.error ?? products.error;
  if (error) {
    return (
      <p role="alert" className="font-semibold text-danger">
        {errorMessage(error)}
      </p>
    );
  }
  if (!ids || ids.length === 0) {
    return (
      <div className="tile-bg rounded-[var(--radius-pan)] p-10 text-center">
        <p className="font-display text-2xl">{t("empty")}</p>
        <p className="mt-2 text-smoke">{t("emptyHint")}</p>
        <Link href="/shop" className="btn btn-primary mt-4">
          {browse("browse")}
        </Link>
      </div>
    );
  }
  if (!products.data) return <div aria-busy="true" className="skeleton h-64" />;
  return <ProductGrid products={products.data} />;
}

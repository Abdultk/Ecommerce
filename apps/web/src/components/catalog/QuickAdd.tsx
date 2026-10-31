"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ProductDetail, type ProductSummary } from "@hp/contracts";
import { useCartDrawer } from "@/components/cart/CartDrawerContext";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { CheckIcon, PlusIcon } from "@/components/ui/Icons";
import { browserApi } from "@/lib/api";
import { cartErrorMessage, useAddToCart } from "@/lib/cart";

type Phase = "idle" | "loading" | "added" | "error";

/**
 * Adds a product to the cart from a listing. The product's variants are read when pressed;
 * a product with a single in-stock variant goes straight in, anything with options opens its
 * page so the shopper chooses (a variant is never guessed).
 */
export function QuickAdd({ product }: { product: ProductSummary }) {
  const t = useTranslations("Product.quickAdd");
  const router = useRouter();
  const addToCart = useAddToCart();
  const drawer = useCartDrawer();
  const { currency } = useStoreConfig();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    if (phase === "loading") return;
    setPhase("loading");
    setMessage("");
    try {
      const { data } = await browserApi.get(
        `/products/${encodeURIComponent(product.slug)}`,
        ProductDetail,
      );
      const [only] = data.variants.filter((v) => v.stockAvailable > 0);
      if (data.variants.length !== 1 || !only) {
        router.push(`/p/${product.slug}`);
        setPhase("idle");
        return;
      }
      addToCart.mutate(
        {
          variantId: only.id,
          quantity: 1,
          currency,
          preview: {
            productSlug: data.slug,
            productName: data.name,
            variantName: only.name,
            sku: only.sku,
            thumbnailUrl: data.images[0]?.url ?? data.thumbnailUrl,
            unitPriceCents: only.priceCents,
            stockAvailable: only.stockAvailable,
          },
        },
        {
          onSuccess: () => {
            setPhase("added");
            setMessage(t("addedMsg", { name: data.name }));
            drawer.open();
            window.setTimeout(() => setPhase("idle"), 2200);
          },
          onError: (error) => {
            setPhase("error");
            setMessage(cartErrorMessage(error));
          },
        },
      );
    } catch {
      setPhase("error");
      setMessage(t("failed"));
    }
  }

  const label =
    phase === "loading"
      ? t("adding")
      : phase === "added"
        ? t("added")
        : product.inStock
          ? t("add")
          : t("soldOut");

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={!product.inStock || phase === "loading"}
        aria-label={t("aria", { label, name: product.name })}
        className="btn btn-primary !min-h-11 w-full gap-2 text-sm"
      >
        {phase === "added" ? <CheckIcon /> : <PlusIcon />}
        {label}
      </button>
      <p role={phase === "error" ? "alert" : "status"} className="sr-only">
        {message}
      </p>
    </>
  );
}

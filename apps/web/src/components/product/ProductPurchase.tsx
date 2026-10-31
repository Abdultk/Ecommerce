"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MAX_LINE_QUANTITY, type ProductDetail, type ProductVariant } from "@hp/contracts";
import { PriceTag } from "@/components/catalog/PriceTag";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { useCartDrawer } from "@/components/cart/CartDrawerContext";
import { MinusIcon, PlusIcon } from "@/components/ui/Icons";
import { cartErrorMessage, useAddToCart } from "@/lib/cart";
import { VariantPicker } from "./VariantPicker";

type Props = { product: ProductDetail };

const firstBuyable = (variants: readonly ProductVariant[]) =>
  variants.find((v) => v.stockAvailable > 0) ?? variants[0];

/** Picker label from the attribute the variants differ on, e.g. "size" → "Size". */
function pickerLabel(
  variants: readonly ProductVariant[],
  t: ReturnType<typeof useTranslations<"Product.purchase">>,
): string {
  const keys = Object.keys(variants[0]?.attributes ?? {});
  const varying = keys.find((key) => new Set(variants.map((v) => v.attributes[key])).size > 1);
  const key = varying ?? keys[0];
  if (!key) return t("option");
  return t.has(`attr.${key}`) ? t(`attr.${key}`) : key.charAt(0).toUpperCase() + key.slice(1);
}

export function ProductPurchase({ product }: Props) {
  const t = useTranslations("Product.purchase");
  const [variantId, setVariantId] = useState(() => firstBuyable(product.variants)?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const addToCart = useAddToCart();
  const { currency } = useStoreConfig();
  const drawer = useCartDrawer();

  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant) return <p className="text-smoke">{t("unavailable")}</p>;

  const soldOut = variant.stockAvailable === 0;
  const maxQuantity = Math.max(1, Math.min(MAX_LINE_QUANTITY, variant.stockAvailable));

  function handleVariantChange(id: string) {
    setVariantId(id);
    setQuantity(1);
    setFeedback(null);
  }

  function handleAdd() {
    if (!variant || soldOut) return;
    setFeedback(null);
    addToCart.mutate(
      {
        variantId: variant.id,
        quantity,
        currency,
        preview: {
          productSlug: product.slug,
          productName: product.name,
          variantName: variant.name,
          sku: variant.sku,
          thumbnailUrl: product.images[0]?.url ?? product.thumbnailUrl,
          unitPriceCents: variant.priceCents,
          stockAvailable: variant.stockAvailable,
        },
      },
      {
        onSuccess: () => {
          setFeedback({ kind: "ok", text: t("added", { quantity, name: product.name }) });
          drawer.open();
        },
        onError: (error) => setFeedback({ kind: "error", text: cartErrorMessage(error) }),
      },
    );
  }

  return (
    <div id="purchase" className="scroll-mt-28 space-y-6">
      <PriceTag
        priceCents={variant.priceCents}
        compareAtCents={variant.compareAtPriceCents}
        size="lg"
      />

      {product.variants.length > 1 ? (
        <VariantPicker
          label={pickerLabel(product.variants, t)}
          variants={product.variants}
          selectedId={variant.id}
          onChange={handleVariantChange}
        />
      ) : null}

      <p className={`text-sm font-semibold ${soldOut ? "text-danger" : "text-sage"}`}>
        {soldOut
          ? t("soldOutSoon")
          : variant.stockAvailable <= 5
            ? t("onlyLeft", { count: variant.stockAvailable })
            : t("inStock")}
      </p>
      <p className="-mt-3 text-sm text-smoke">{t("sku", { sku: variant.sku })}</p>

      <div className="flex flex-wrap items-stretch gap-3">
        <div
          className="flex items-center rounded-[var(--radius-btn)] border-[1.5px] border-line bg-crust"
          role="group"
          aria-label={t("quantity")}
        >
          <button
            type="button"
            aria-label={t("decrease")}
            className="grid size-11 place-items-center rounded-md transition-colors hover:bg-parchment disabled:text-line"
            disabled={quantity <= 1 || soldOut}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            <MinusIcon />
          </button>
          <span aria-live="polite" className="w-8 text-center font-semibold">
            <span className="sr-only">{t("quantity")} </span>
            {quantity}
          </span>
          <button
            type="button"
            aria-label={t("increase")}
            className="grid size-11 place-items-center rounded-md transition-colors hover:bg-parchment disabled:text-line"
            disabled={quantity >= maxQuantity || soldOut}
            onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
          >
            <PlusIcon />
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary flex-1 text-base"
          disabled={soldOut || addToCart.isPending}
          onClick={handleAdd}
        >
          {soldOut ? t("soldOut") : addToCart.isPending ? t("adding") : t("add")}
        </button>
      </div>

      {feedback?.kind === "error" ? (
        <p
          role="alert"
          className="rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
        >
          {feedback.text}
        </p>
      ) : null}
      <p
        role="status"
        className={feedback?.kind === "ok" ? "text-sm font-semibold text-sage" : "sr-only"}
      >
        {feedback?.kind === "ok" ? feedback.text : ""}
      </p>
    </div>
  );
}

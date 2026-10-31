"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { ProductVariant } from "@hp/contracts";
import { formatMoney } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";

type Props = {
  label: string;
  variants: readonly ProductVariant[];
  selectedId: string;
  onChange: (variantId: string) => void;
};

/**
 * WAI-ARIA radio group with a roving tab stop: Tab enters at the selected option,
 * arrows move and select (wrapping), Home/End jump. Sold-out options stay selectable
 * so shoppers can see them; the add-to-cart button explains they can't be bought.
 */
export function VariantPicker({ label, variants, selectedId, onChange }: Props) {
  const { currency } = useStoreConfig();
  const t = useTranslations("Product.purchase");
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    variants.findIndex((v) => v.id === selectedId),
  );
  const prices = new Set(variants.map((v) => v.priceCents));

  function select(index: number) {
    const variant = variants[index];
    if (!variant) return;
    onChange(variant.id);
    refs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = variants.length - 1;
    // In RTL the visual order is reversed, so swap left/right arrows.
    const isRtl = document.documentElement.dir === "rtl";
    const nextKeys = isRtl
      ? new Set(["ArrowLeft", "ArrowDown"])
      : new Set(["ArrowRight", "ArrowDown"]);
    const prevKeys = isRtl
      ? new Set(["ArrowRight", "ArrowUp"])
      : new Set(["ArrowLeft", "ArrowUp"]);
    let target: number | null = null;
    if (nextKeys.has(event.key)) target = selectedIndex === last ? 0 : selectedIndex + 1;
    else if (prevKeys.has(event.key)) target = selectedIndex === 0 ? last : selectedIndex - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    if (target === null) return;
    event.preventDefault();
    select(target);
  }

  return (
    <div>
      <p id={labelId} className="stamp mb-2">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {variants.map((variant, index) => {
          const checked = index === selectedIndex;
          const soldOut = variant.stockAvailable === 0;
          return (
            <button
              key={variant.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => select(index)}
              onKeyDown={handleKeyDown}
              className={`min-h-11 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-colors ${
                checked
                  ? "border-iron bg-iron text-crust"
                  : "border-stroke bg-crust text-iron hover:border-iron"
              } ${soldOut ? "line-through decoration-2" : ""}`}
            >
              {variant.name}
              {prices.size > 1 ? (
                <span className="ms-1.5 font-normal opacity-80">
                  {formatMoney(variant.priceCents, currency)}
                </span>
              ) : null}
              {soldOut ? <span className="sr-only"> {t("soldOutSr")}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

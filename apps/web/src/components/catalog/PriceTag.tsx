"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { discountPercent } from "@/lib/format";

type Props = {
  priceCents: number;
  compareAtCents?: number | null;
  from?: boolean;
  size?: "sm" | "lg";
};

export function PriceTag({ priceCents, compareAtCents = null, from = false, size = "sm" }: Props) {
  const { currency } = useStoreConfig();
  const t = useTranslations("Product.price");
  const saving = discountPercent(priceCents, compareAtCents);
  const priceClass = size === "lg" ? "text-3xl font-display" : "text-lg font-semibold";

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {from ? (
        <span className="text-xs font-medium uppercase tracking-wider text-smoke">{t("from")}</span>
      ) : null}
      <span data-testid="price" className={`${priceClass} text-iron`}>
        {formatMoney(priceCents, currency)}
      </span>
      {saving !== null && compareAtCents !== null ? (
        <>
          <s className="text-smoke">
            <span className="sr-only">{t("was")}</span>
            {formatMoney(compareAtCents, currency)}
          </s>
          <span className="rounded-full bg-ember-wash px-2 py-0.5 text-xs font-bold text-ember-deep">
            {t("save", { percent: saving })}
          </span>
        </>
      ) : null}
    </p>
  );
}

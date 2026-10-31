"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";

interface FreeShippingMeterProps {
  subtotalCents: number;
}

export function FreeShippingMeter({ subtotalCents }: FreeShippingMeterProps) {
  const t = useTranslations("Cart.freeShipping");
  const { currency, freeShippingThresholdCents } = useStoreConfig();

  if (!freeShippingThresholdCents || freeShippingThresholdCents <= 0) {
    return null;
  }

  const isUnlocked = subtotalCents >= freeShippingThresholdCents;
  const remainingCents = Math.max(0, freeShippingThresholdCents - subtotalCents);
  const percent = Math.min(100, Math.round((subtotalCents / freeShippingThresholdCents) * 100));

  return (
    <div className="mb-4 rounded-tile border border-line bg-parchment/50 p-3.5 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium">
        <div className="flex items-center gap-1.5">
          {isUnlocked ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-forest text-[10px] text-flour font-bold">
              ✓
            </span>
          ) : (
            <svg className="size-3.5 text-copper" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          )}
          <span className={isUnlocked ? "font-semibold text-forest" : "text-iron"}>
            {isUnlocked
              ? t("unlocked")
              : t("remaining", { amount: formatMoney(remainingCents, currency) })}
          </span>
        </div>
        <span className="font-mono text-[11px] text-smoke">{percent}%</span>
      </div>

      {/* Animated Gradient Progress Track */}
      <div
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-crust"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progressAria", { percent })}
      >
        <div
          className={`h-full transition-all duration-700 ease-[var(--ease-sear)] ${
            isUnlocked
              ? "bg-forest shadow-sm"
              : "bg-gradient-to-r from-copper to-ember-deep"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

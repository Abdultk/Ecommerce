"use client";

import { useTranslations } from "next-intl";
import {
  formatMoney,
  type CurrencyCode,
  type ShippingMethod,
  type ShippingOption,
} from "@hp/contracts";

type Props = {
  options: readonly ShippingOption[];
  currency: CurrencyCode;
  selected: ShippingMethod;
  onChange: (method: ShippingMethod) => void;
};

/** Price, delivery window and name of a shipping option, in the shopper's language. */
export function useShippingText() {
  const t = useTranslations("Checkout");
  const methods = useTranslations("Order.shippingMethod");
  return {
    price: (cents: number, currency: CurrencyCode) =>
      cents === 0 ? t("shippingFree") : formatMoney(cents, currency),
    window: ({ estimatedDays: d }: ShippingOption) =>
      d.min === d.max
        ? t("businessDaysExact", { days: d.min })
        : t("businessDays", { min: d.min, max: d.max }),
    // The API's own label covers any method the messages don't know yet.
    name: ({ method, label }: ShippingOption) => (methods.has(method) ? methods(method) : label),
  };
}

/** Step 2: the API's shipping options as a native radio group (arrow keys work). */
export function ShippingOptions({ options, currency, selected, onChange }: Props) {
  const t = useTranslations("Checkout");
  const text = useShippingText();
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{t("step.shipping")}</legend>
      {options.map((option) => (
        <label
          key={option.method}
          className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-tile)] border-2 border-line bg-crust p-4 has-[:checked]:border-ember"
        >
          <input
            type="radio"
            name="shippingMethod"
            value={option.method}
            checked={selected === option.method}
            onChange={() => onChange(option.method)}
            className="size-5 accent-ember"
          />
          <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4">
            <span className="font-semibold">{text.name(option)}</span>
            <span className="text-sm text-smoke">{text.window(option)}</span>
          </span>
          <span className="font-semibold">
            <span className="sr-only">, </span>
            {text.price(option.priceCents, currency)}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

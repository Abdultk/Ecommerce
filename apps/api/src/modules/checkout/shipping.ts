import type { ShippingMethod, ShippingOption, ShippingSettings } from "@hp/contracts";

/*
 * Shipping rates, the free-shipping threshold and delivery times come from store settings
 * (admin → Settings → Shipping). VAT is a flat store-wide rate, also from settings
 * (vatRateBps); the old per-US-state table is gone.
 */

const LABELS: Readonly<Record<ShippingMethod, string>> = {
  standard: "Standard",
  express: "Express",
};
const METHODS: readonly ShippingMethod[] = ["standard", "express"];

export function shippingCents(
  method: ShippingMethod,
  subtotalCents: number,
  rates: ShippingSettings,
): number {
  if (method === "express") return rates.expressCents;
  const threshold = rates.freeShippingThresholdCents;
  return threshold !== null && subtotalCents >= threshold ? 0 : rates.standardCents;
}

export function shippingOptions(subtotalCents: number, rates: ShippingSettings): ShippingOption[] {
  return METHODS.map((method) => ({
    method,
    label: LABELS[method],
    priceCents: shippingCents(method, subtotalCents, rates),
    estimatedDays: method === "standard" ? rates.standardDays : rates.expressDays,
  }));
}

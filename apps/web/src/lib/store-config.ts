import { CURRENCIES, PublicStoreConfig, formatMoney, type CurrencyCode } from "@hp/contracts";
import type { CatalogApi } from "./internal-api";

/**
 * Used only when GET /store is unreachable during a render: an Omani shop taking cards.
 * The API still checks the payment method at checkout (422 PAYMENT_METHOD_UNAVAILABLE).
 */
export const DEFAULT_STORE_CONFIG: PublicStoreConfig = Object.freeze({
  storeName: "PAISLEY art",
  currency: "OMR",
  vatRateBps: 500,
  freeShippingThresholdCents: null,
  paymentMethods: Object.freeze(["card"]) as PublicStoreConfig["paymentMethods"],
  manualMethods: [],
});

/** Public store settings (currency, free-shipping threshold, enabled payment methods). */
export async function getStoreConfig(api: CatalogApi): Promise<PublicStoreConfig> {
  return (await api.get("/store", PublicStoreConfig)).data;
}

/** The header banner's promise, or null when free shipping is switched off. */
export function freeShippingText(config: PublicStoreConfig): string | null {
  const threshold = config.freeShippingThresholdCents;
  return threshold === null
    ? null
    : `Free shipping over ${formatMoney(threshold, config.currency)}`;
}

export const currencyName = (code: CurrencyCode): string => CURRENCIES[code].name;

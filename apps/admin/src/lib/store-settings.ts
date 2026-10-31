"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { createEndpoints, type Endpoints } from "@hp/api-client";
import { can, formatMoney, type CurrencyCode } from "@hp/contracts";
import { formatCompactMoney } from "./money";
import { SETTINGS_KEY, STORE_CONFIG_KEY } from "./query-keys";
import { useSession } from "./session";

/** Shown only until the store currency has loaded; the seeded store is Omani. */
export const DEFAULT_STORE_CURRENCY: CurrencyCode = "OMR";

/** Typed Phase 3b calls on the signed-in client (same token refresh and error handling). */
export function useEndpoints(): Endpoints {
  const { api } = useSession();
  return useMemo(() => createEndpoints(api), [api]);
}

/** GET /admin/settings (settings:read). Shared cache with the Settings page. */
export function useStoreSettings(enabled = true) {
  const endpoints = useEndpoints();
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await endpoints.adminSettings.get()).data,
    enabled,
  });
}

export type StoreCurrency = { currency: CurrencyCode; isReady: boolean };

/**
 * The store currency for amounts that carry none (catalog prices, coupons, analytics).
 * Roles with settings:read use GET /admin/settings; STAFF uses the public GET /store.
 * Order screens use the order's own currency instead.
 */
export function useStoreCurrency(): StoreCurrency {
  const { user } = useSession();
  const endpoints = useEndpoints();
  const canReadSettings = user !== null && can(user.role, "settings:read");
  const settings = useStoreSettings(canReadSettings);
  const store = useQuery({
    queryKey: STORE_CONFIG_KEY,
    queryFn: async () => (await endpoints.store.get()).data,
    enabled: user !== null && !canReadSettings,
  });
  const currency = canReadSettings ? settings.data?.currency : store.data?.currency;
  return { currency: currency ?? DEFAULT_STORE_CURRENCY, isReady: currency !== undefined };
}

export type MoneyFormat = {
  currency: CurrencyCode;
  format(minor: number): string;
  compact(minor: number): string;
};

/** Formatters for amounts in the store currency (analytics, catalog, coupons). */
export function useMoneyFormat(): MoneyFormat {
  const { currency } = useStoreCurrency();
  return useMemo(
    () => ({
      currency,
      format: (minor: number) => formatMoney(minor, currency),
      compact: (minor: number) => formatCompactMoney(minor, currency),
    }),
    [currency],
  );
}

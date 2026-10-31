"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PublicStoreConfig } from "@hp/contracts";
import { DEFAULT_STORE_CONFIG } from "@/lib/store-config";

const StoreConfigContext = createContext<PublicStoreConfig>(DEFAULT_STORE_CONFIG);

/** Hands the server-fetched GET /store answer to client components. */
export function StoreConfigProvider({
  config,
  children,
}: {
  config: PublicStoreConfig;
  children: ReactNode;
}) {
  return <StoreConfigContext.Provider value={config}>{children}</StoreConfigContext.Provider>;
}

/** Store currency, free-shipping threshold and the payment methods enabled in admin. */
export function useStoreConfig(): PublicStoreConfig {
  return useContext(StoreConfigContext);
}

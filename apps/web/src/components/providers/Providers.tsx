"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicStoreConfig } from "@hp/contracts";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartDrawerProvider } from "@/components/cart/CartDrawerContext";
import { SmoothScroll } from "@/components/fx/SmoothScroll";
import { refreshSession } from "@/lib/auth-store";
import { clearCacheOnSessionChange } from "@/lib/session-cache";
import { StoreConfigProvider } from "./StoreConfig";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });
}

type Props = { children: ReactNode; storeConfig: PublicStoreConfig };

/**
 * Client-side app shell: store settings, query cache, silent session restore,
 * cart drawer.
 */
export function Providers({ children, storeConfig }: Props) {
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    // Restores the in-memory access token from the httpOnly refresh cookie after a reload.
    void refreshSession();
  }, []);

  useEffect(() => clearCacheOnSessionChange(queryClient), [queryClient]);

  return (
    <StoreConfigProvider config={storeConfig}>
      <QueryClientProvider client={queryClient}>
        <CartDrawerProvider>
          <SmoothScroll />
          {children}
          <CartDrawer />
        </CartDrawerProvider>
      </QueryClientProvider>
    </StoreConfigProvider>
  );
}

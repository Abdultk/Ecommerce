import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PublicStoreConfig } from "@hp/contracts";
import enMessages from "../../messages/en.json";
import { CartDrawerProvider } from "@/components/cart/CartDrawerContext";
import { StoreConfigProvider } from "@/components/providers/StoreConfig";
import { authStore } from "@/lib/auth-store";
import { MOCK_STORE_CONFIG } from "@/test/msw/store";

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

type RenderOptions = {
  /**
   * In the app, Providers always settles the session on load (signed in or guest). By default
   * tests start settled as a guest; pass false to test the moment before it settles.
   */
  settleAuth?: boolean;
  /** GET /store as the layout would pass it; defaults to the mock API's answer. */
  storeConfig?: PublicStoreConfig;
};

/** Renders inside the same providers the app uses (minus mocking/auth bootstrap). */
export function renderWithProviders(
  ui: ReactElement,
  client: QueryClient = makeTestQueryClient(),
  { settleAuth = true, storeConfig = MOCK_STORE_CONFIG }: RenderOptions = {},
) {
  if (settleAuth && !authStore.getState().ready) authStore.clear();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StoreConfigProvider config={storeConfig}>
        <QueryClientProvider client={client}>
          <CartDrawerProvider>{children}</CartDrawerProvider>
        </QueryClientProvider>
      </StoreConfigProvider>
    </NextIntlClientProvider>
  );
  return { ...render(ui, { wrapper }), client };
}

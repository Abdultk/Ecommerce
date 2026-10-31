import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { fail, type Cart } from "@hp/contracts";
import { authStore } from "@/lib/auth-store";
import { cartQueryKey, useAddToCart } from "@/lib/cart";
import { makeTestQueryClient } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";

setupMockApi();

const preview = {
  productSlug: "chefs-knife-8in",
  productName: "Chef's Knife",
  variantName: "8 inch",
  sku: "BR-CK8",
  thumbnailUrl: null,
  unitPriceCents: 8900,
  stockAvailable: 30,
};

beforeEach(() => authStore.clear());

describe("cart rollback", () => {
  it("drops the optimistic line when the very first add fails (nothing to roll back to)", async () => {
    server.use(
      http.post(`${API_URL}/cart/items`, () =>
        HttpResponse.json(fail("OUT_OF_STOCK", "Only 0 left."), { status: 409 }),
      ),
    );
    const client = makeTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ variantId: "v_sample_04_1", quantity: 1, preview, currency: "OMR" })
        .catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<Cart>(cartQueryKey(null));
    expect(cached?.items.some((line) => line.id.startsWith("optimistic_")) ?? false).toBe(false);
  });
});

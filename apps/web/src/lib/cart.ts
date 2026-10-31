"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApplyCouponInput, Cart, type CartLine, type CurrencyCode } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { browserApi } from "./api";
import { useAuth } from "./use-auth";

/** Prefix of every cart query; use it to cancel or invalidate the cart whoever owns it. */
export const CART_QUERY_KEY = ["cart"] as const;

/** The cart cache is per credential: one signed-in user's cart never shows for a guest or another user. */
export const cartQueryKey = (userId: string | null) =>
  [...CART_QUERY_KEY, userId ?? "guest"] as const;

/** Key of the cart that belongs to whoever is signed in now. */
export function useCartQueryKey() {
  const { user } = useAuth();
  return cartQueryKey(user?.id ?? null);
}

/** Display fields for the optimistic line, taken from the product page. */
export type CartLinePreview = Pick<
  CartLine,
  | "productSlug"
  | "productName"
  | "variantName"
  | "sku"
  | "thumbnailUrl"
  | "unitPriceCents"
  | "stockAvailable"
>;

export type AddToCartVariables = {
  variantId: string;
  quantity: number;
  preview: CartLinePreview;
  /** Store currency: labels an optimistic cart before the server's first cart exists. */
  currency: CurrencyCode;
};

const DEFAULT_CURRENCY: CurrencyCode = "OMR";

const EMPTY_TOTALS = {
  subtotalCents: 0,
  discountCents: 0,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 0,
};

export function cartItemCount(cart: Cart | undefined): number {
  return cart?.items.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
}

/**
 * A best guess at the server's answer, shown while the request is in flight. Totals are
 * the server's job; this only keeps subtotal and total consistent until the real cart lands.
 */
export function applyOptimisticAdd(cart: Cart | undefined, vars: AddToCartVariables): Cart {
  const items = cart?.items ?? [];
  const existing = items.find((line) => line.variantId === vars.variantId);
  const nextItems: CartLine[] = existing
    ? items.map((line) =>
        line === existing
          ? {
              ...line,
              quantity: line.quantity + vars.quantity,
              lineTotalCents: line.unitPriceCents * (line.quantity + vars.quantity),
            }
          : line,
      )
    : [
        ...items,
        {
          ...vars.preview,
          id: `optimistic_${vars.variantId}`,
          variantId: vars.variantId,
          quantity: vars.quantity,
          lineTotalCents: vars.preview.unitPriceCents * vars.quantity,
        },
      ];
  return withLines(cart, nextItems, vars.currency);
}

/** The cart with new lines; subtotal/total stay consistent until the server's cart lands. */
function withLines(cart: Cart | undefined, items: CartLine[], currency?: CurrencyCode): Cart {
  const totals = cart?.totals ?? EMPTY_TOTALS;
  const subtotalCents = items.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return {
    id: cart?.id ?? "optimistic_cart",
    couponCode: cart?.couponCode ?? null,
    // An existing cart keeps its own currency; without one there are no lines to mislabel
    // except the one being added, priced in the store currency.
    currency: cart?.currency ?? currency ?? DEFAULT_CURRENCY,
    items,
    totals: {
      ...totals,
      subtotalCents,
      totalCents: subtotalCents - totals.discountCents + totals.shippingCents + totals.taxCents,
    },
  };
}

export function applyOptimisticQuantity(
  cart: Cart | undefined,
  lineId: string,
  quantity: number,
): Cart {
  const items = (cart?.items ?? []).map((line) =>
    line.id === lineId
      ? { ...line, quantity, lineTotalCents: line.unitPriceCents * quantity }
      : line,
  );
  return withLines(cart, items);
}

export function applyOptimisticRemove(cart: Cart | undefined, lineId: string): Cart {
  return withLines(
    cart,
    (cart?.items ?? []).filter((line) => line.id !== lineId),
  );
}

/**
 * The current cart. Waits until the silent session refresh has settled: fetching earlier
 * would send no bearer token and cache the guest cart for a signed-in customer (D-03).
 */
export function useCart() {
  const { ready, user } = useAuth();
  return useQuery({
    queryKey: cartQueryKey(user?.id ?? null),
    queryFn: async () => (await browserApi.get("/cart", Cart)).data,
    enabled: ready,
    staleTime: 30_000,
  });
}

/**
 * After a failed cart mutation: restore the snapshot, or, when there was none (the first
 * add before the cart loaded), clear the optimistic cart. Then refetch the server's cart.
 */
function rollbackCart(
  queryClient: QueryClient,
  key: readonly unknown[],
  previous: Cart | undefined,
): Promise<void> {
  if (previous) queryClient.setQueryData<Cart>(key, previous);
  else queryClient.removeQueries({ queryKey: key, exact: true });
  return queryClient.invalidateQueries({ queryKey: key });
}

const FALLBACK_ADD_ERROR = "We couldn't add that to your cart. Please try again.";

export function cartErrorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : FALLBACK_ADD_ERROR;
}

export function useAddToCart() {
  const queryClient = useQueryClient();
  const key = useCartQueryKey();
  return useMutation({
    mutationFn: async ({ variantId, quantity }: AddToCartVariables) =>
      (await browserApi.post("/cart/items", { variantId, quantity }, Cart)).data,
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<Cart>(key);
      queryClient.setQueryData<Cart>(key, applyOptimisticAdd(previous, vars));
      return { previous };
    },
    // Roll back; the caller shows the error (e.g. OUT_OF_STOCK).
    onError: (_error, _vars, context) => rollbackCart(queryClient, key, context?.previous),
    onSuccess: (cart) => {
      queryClient.setQueryData<Cart>(key, cart);
    },
  });
}

/**
 * Snapshot → optimistic cart → server cart, or roll back to the snapshot on error
 * (e.g. OUT_OF_STOCK); the caller shows the message.
 */
function useOptimisticCartMutation<V>(
  request: (vars: V) => Promise<Cart>,
  optimistic: (cart: Cart | undefined, vars: V) => Cart,
) {
  const queryClient = useQueryClient();
  const key = useCartQueryKey();
  return useMutation({
    mutationFn: request,
    onMutate: async (vars: V) => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<Cart>(key);
      queryClient.setQueryData<Cart>(key, optimistic(previous, vars));
      return { previous };
    },
    onError: (_error, _vars, context) => rollbackCart(queryClient, key, context?.previous),
    onSuccess: (cart) => {
      queryClient.setQueryData<Cart>(key, cart);
    },
  });
}

export type UpdateQuantityVariables = { lineId: string; quantity: number };

export function useUpdateCartItem() {
  return useOptimisticCartMutation<UpdateQuantityVariables>(
    async ({ lineId, quantity }) =>
      (await browserApi.patch(`/cart/items/${encodeURIComponent(lineId)}`, { quantity }, Cart))
        .data,
    (cart, { lineId, quantity }) => applyOptimisticQuantity(cart, lineId, quantity),
  );
}

export function useRemoveCartItem() {
  return useOptimisticCartMutation<string>(
    async (lineId) =>
      (await browserApi.delete(`/cart/items/${encodeURIComponent(lineId)}`, Cart)).data,
    applyOptimisticRemove,
  );
}

/** After sign-in: folds the guest cart (cookie) into the account's cart (bearer). */
export async function mergeGuestCart(): Promise<Cart> {
  return (await browserApi.post("/cart/merge", {}, Cart)).data;
}

/** Applies a discount code; the server prices it and returns the cart (not optimistic). */
export function useApplyCoupon() {
  const queryClient = useQueryClient();
  const key = useCartQueryKey();
  return useMutation({
    mutationFn: async (input: ApplyCouponInput) =>
      (await browserApi.post("/cart/coupon", input, Cart)).data,
    onSuccess: (cart) => queryClient.setQueryData<Cart>(key, cart),
  });
}

export function useRemoveCoupon() {
  const queryClient = useQueryClient();
  const key = useCartQueryKey();
  return useMutation({
    mutationFn: async () => (await browserApi.delete("/cart/coupon", Cart)).data,
    onSuccess: (cart) => queryClient.setQueryData<Cart>(key, cart),
  });
}

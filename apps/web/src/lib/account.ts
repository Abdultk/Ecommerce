"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Address,
  ProductSummary,
  PublicUser,
  WishlistItem,
  type AddressInput,
  type ProfileUpdate,
} from "@hp/contracts";
import { browserApi } from "./api";
import { authStore } from "./auth-store";
import { useAuth } from "./use-auth";

// Account data is keyed by user id, so one customer's cache never shows for another.

const Deleted = z.object({ deleted: z.literal(true) });

export const accountKeys = {
  addresses: (userId: string | undefined) => ["addresses", userId] as const,
  wishlist: (userId: string | undefined) => ["wishlist", userId] as const,
  wishlistProducts: (userId: string | undefined) => ["wishlist-products", userId] as const,
};

// ---------- Profile ----------

export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (input: ProfileUpdate) =>
      (await browserApi.patch("/me", input, PublicUser)).data,
    onSuccess: (user) => authStore.setUser(user),
  });
}

// ---------- Addresses ----------

export function useAddresses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: accountKeys.addresses(user?.id),
    enabled: Boolean(user),
    queryFn: async () =>
      (await browserApi.get("/me/addresses", z.array(Address) as z.ZodType<Address[]>)).data,
  });
}

export function useSaveAddress() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: AddressInput }) =>
      id
        ? (await browserApi.patch(`/me/addresses/${encodeURIComponent(id)}`, input, Address)).data
        : (await browserApi.post("/me/addresses", input, Address)).data,
    // A new default unsets the others on the server, so re-read the whole list.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses(user?.id) }),
  });
}

export function useDeleteAddress() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await browserApi.delete(`/me/addresses/${encodeURIComponent(id)}`, Deleted)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.addresses(user?.id) }),
  });
}

// ---------- Wishlist ----------

export function useWishlist() {
  const { user } = useAuth();
  return useQuery({
    queryKey: accountKeys.wishlist(user?.id),
    enabled: Boolean(user),
    queryFn: async () => (await browserApi.get("/me/wishlist", z.array(WishlistItem))).data,
  });
}

/** Product summaries for the saved ids; keyed by the ids so a heart toggle refetches. */
export function useWishlistProducts(ids: readonly string[] | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...accountKeys.wishlistProducts(user?.id), ids?.join(",")],
    enabled: Boolean(user && ids && ids.length > 0),
    queryFn: async () =>
      (await browserApi.get("/me/wishlist/products", z.array(ProductSummary))).data,
  });
}

type ToggleVars = { productId: string; saved: boolean };

/** Optimistic heart toggle that rolls back if the API refuses. */
export function useToggleWishlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = accountKeys.wishlist(user?.id);
  return useMutation({
    mutationFn: async ({ productId, saved }: ToggleVars) => {
      if (saved) {
        await browserApi.delete(`/me/wishlist/${encodeURIComponent(productId)}`, Deleted);
      } else {
        await browserApi.post("/me/wishlist", { productId }, WishlistItem);
      }
    },
    onMutate: async ({ productId, saved }: ToggleVars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WishlistItem[]>(key);
      const current = previous ?? [];
      queryClient.setQueryData<WishlistItem[]>(
        key,
        saved
          ? current.filter((item) => item.productId !== productId)
          : [{ productId, addedAt: new Date().toISOString() }, ...current],
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(key, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

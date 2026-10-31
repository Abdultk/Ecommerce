import { http, HttpResponse } from "msw";
import { z } from "zod";
import {
  Address,
  AddressInput,
  Id,
  ProfileUpdate,
  ok,
  type PublicUser,
  type WishlistItem,
} from "@hp/contracts";
import { toSummary } from "@hp/test-utils";
import {
  errorResponse,
  readJson,
  readMockCart,
  requestUser,
  unauthenticated,
  validationError,
  type MockStore,
} from "./state";

export const MAX_ADDRESSES = 20;
const WishlistInput = z.object({ productId: Id });
const DELETED = { deleted: true } as const;

/** Default address first, then by id — the API's order. */
const sorted = (addresses: readonly Address[]): Address[] =>
  [...addresses].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id.localeCompare(b.id),
  );

/** Saving a default address unsets every other one. */
function withAddress(addresses: readonly Address[], address: Address): Address[] {
  const exists = addresses.some((a) => a.id === address.id);
  const merged = exists
    ? addresses.map((a) => (a.id === address.id ? address : a))
    : [...addresses, address];
  return address.isDefault
    ? merged.map((a) => (a.id === address.id ? a : { ...a, isDefault: false }))
    : merged;
}

/** Deleting the default promotes another address so there is still one. */
function withoutAddress(addresses: readonly Address[], id: string): Address[] {
  const removed = addresses.find((a) => a.id === id);
  const rest = addresses.filter((a) => a.id !== id);
  if (!removed?.isDefault || rest.length === 0) return rest;
  const next = [...rest].sort((a, b) => a.id.localeCompare(b.id))[0]!;
  return rest.map((a) => (a.id === next.id ? { ...a, isDefault: true } : a));
}

const newestFirst = (items: readonly WishlistItem[]): WishlistItem[] =>
  [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt));

type Args = { request: Request; params: Record<string, unknown> };

export function createAccountHandlers(store: MockStore) {
  const { baseUrl, products } = store;

  /** Wraps a handler so it only runs for a signed-in user. */
  const authed =
    <R>(handler: (args: Args, user: PublicUser) => R) =>
    (args: Args) => {
      const user = requestUser(args.request, store);
      return user ? handler(args, user) : unauthenticated();
    };

  const findAddress = (id: unknown) => store.get().addresses.find((a) => a.id === id);
  const addressNotFound = () => errorResponse("NOT_FOUND", "Address not found.");

  return [
    http.get(
      `${baseUrl}/me`,
      authed((_args, user) => HttpResponse.json(ok(user))),
    ),

    http.patch(
      `${baseUrl}/me`,
      authed(async ({ request }, user) => {
        const parsed = ProfileUpdate.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        const next = { ...user, ...parsed.data };
        store.update((s) => ({ ...s, user: next }));
        return HttpResponse.json(ok(next));
      }),
    ),

    http.get(
      `${baseUrl}/me/addresses`,
      authed(() => HttpResponse.json(ok(sorted(store.get().addresses)))),
    ),

    http.post(
      `${baseUrl}/me/addresses`,
      authed(async ({ request }) => {
        const parsed = AddressInput.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        const count = store.get().addresses.length;
        if (count >= MAX_ADDRESSES) {
          return errorResponse(
            "VALIDATION_ERROR",
            `You can save up to ${MAX_ADDRESSES} addresses.`,
          );
        }
        const address = Address.parse({
          ...parsed.data,
          isDefault: parsed.data.isDefault || count === 0,
          id: store.id("addr"),
        });
        store.update((s) => ({ ...s, addresses: withAddress(s.addresses, address) }));
        return HttpResponse.json(ok(address), { status: 201 });
      }),
    ),

    http.patch(
      `${baseUrl}/me/addresses/:id`,
      authed(async ({ request, params }) => {
        const existing = findAddress(params.id);
        if (!existing) return addressNotFound();
        const parsed = AddressInput.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        const address = Address.parse({
          ...parsed.data,
          isDefault: parsed.data.isDefault || existing.isDefault,
          id: existing.id,
        });
        store.update((s) => ({ ...s, addresses: withAddress(s.addresses, address) }));
        return HttpResponse.json(ok(address));
      }),
    ),

    http.delete(
      `${baseUrl}/me/addresses/:id`,
      authed(({ params }) => {
        if (!findAddress(params.id)) return addressNotFound();
        store.update((s) => ({ ...s, addresses: withoutAddress(s.addresses, String(params.id)) }));
        return HttpResponse.json(ok(DELETED));
      }),
    ),

    http.get(
      `${baseUrl}/me/wishlist`,
      authed(() => HttpResponse.json(ok(newestFirst(store.get().wishlist)))),
    ),

    http.get(
      `${baseUrl}/me/wishlist/products`,
      authed(() =>
        HttpResponse.json(
          ok(
            newestFirst(store.get().wishlist).flatMap(({ productId }) => {
              const product = products.find((p) => p.id === productId);
              return product ? [toSummary(product)] : [];
            }),
          ),
        ),
      ),
    ),

    http.post(
      `${baseUrl}/me/wishlist`,
      authed(async ({ request }) => {
        const parsed = WishlistInput.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        const { productId } = parsed.data;
        if (!products.some((p) => p.id === productId)) {
          return errorResponse("NOT_FOUND", "Product not found.");
        }
        const existing = store.get().wishlist.find((w) => w.productId === productId);
        const item = existing ?? { productId, addedAt: new Date().toISOString() };
        if (!existing) store.update((s) => ({ ...s, wishlist: [...s.wishlist, item] }));
        return HttpResponse.json(ok(item), { status: 201 });
      }),
    ),

    http.delete(
      `${baseUrl}/me/wishlist/:productId`,
      authed(({ params }) => {
        store.update((s) => ({
          ...s,
          wishlist: s.wishlist.filter((w) => w.productId !== params.productId),
        }));
        return HttpResponse.json(ok(DELETED));
      }),
    ),

    // The mock keeps one cart, so merging the guest cart into the account's is a read.
    http.post(
      `${baseUrl}/cart/merge`,
      authed(async () => HttpResponse.json(ok(await readMockCart(baseUrl)))),
    ),
  ];
}

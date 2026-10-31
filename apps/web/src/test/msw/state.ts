import { HttpResponse } from "msw";
import {
  Cart,
  ERROR_HTTP_STATUS,
  envelope,
  fail,
  type Address,
  type ErrorCode,
  type WishlistItem,
  type OrderDetail,
  type ProductDetail,
  type PublicUser,
  type Review,
} from "@hp/contracts";

// Shared, per-handler-set state for the app-local mocks. Every update replaces the
// state object, so handlers never see a half-applied change.

export type MockOrder = {
  detail: OrderDetail;
  /** null for guest orders. */
  ownerId: string | null;
  lookupToken: string;
  idempotencyKey: string | null;
};

export type MockState = {
  /** The account behind the simulated refresh cookie. */
  user: PublicUser | null;
  orders: readonly MockOrder[];
  addresses: readonly Address[];
  wishlist: readonly WishlistItem[];
  reviews: Readonly<Record<string, readonly Review[]>>;
  /** `${userId}:${productSlug}` for reviews already written. */
  reviewed: readonly string[];
  /** Units sold per variant since the handler set started (reduces available stock). */
  sold: Readonly<Record<string, number>>;
  nextOrderSequence: number;
  nextId: number;
};

export type MockStore = {
  get(): MockState;
  update(change: (state: MockState) => MockState): MockState;
  /** Fresh id with the given prefix, e.g. "addr_mock_0007". */
  id(prefix: string): string;
  products: readonly ProductDetail[];
  baseUrl: string;
};

export function createMockStore(
  baseUrl: string,
  products: readonly ProductDetail[],
  initial: MockState,
): MockStore {
  let state = initial;
  const update = (change: (s: MockState) => MockState) => {
    state = change(state);
    return state;
  };
  return {
    get: () => state,
    update,
    id(prefix) {
      const next = update((s) => ({ ...s, nextId: s.nextId + 1 }));
      return `${prefix}_mock_${String(next.nextId).padStart(4, "0")}`;
    },
    products,
    baseUrl,
  };
}

export const errorResponse = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => HttpResponse.json(fail(code, message, details), { status: ERROR_HTTP_STATUS[code] });

export const readJson = (request: Request): Promise<unknown> => request.json().catch(() => null);

export const validationError = (fieldErrors: Record<string, unknown>) =>
  errorResponse("VALIDATION_ERROR", "Some fields are invalid.", fieldErrors);

/** Access tokens minted by the auth mock look like "mock-access-N". */
const MOCK_BEARER = /^Bearer mock-access-\d+$/;

/** The signed-in user for this request: a mock bearer token plus a live mock session. */
export function requestUser(request: Request, store: MockStore): PublicUser | null {
  const header = request.headers.get("authorization") ?? "";
  return MOCK_BEARER.test(header) ? store.get().user : null;
}

export const unauthenticated = () => errorResponse("UNAUTHENTICATED", "Please sign in.");

const CartEnvelope = envelope(Cart);

/**
 * Reads the shared mock cart (owned by @hp/test-utils/msw). The nested request is
 * served by the same MSW handler set, so checkout sees exactly what the cart shows.
 */
export async function readMockCart(baseUrl: string): Promise<Cart> {
  const res = await fetch(`${baseUrl}/cart`, { headers: { Accept: "application/json" } });
  const body = CartEnvelope.parse(await res.json());
  if (!body.success) throw new Error(body.error.message);
  return body.data;
}

/** Empties the shared mock cart after a paid order, line by line through its own API. */
export async function clearMockCart(baseUrl: string): Promise<void> {
  const cart = await readMockCart(baseUrl);
  for (const line of cart.items) {
    await fetch(`${baseUrl}/cart/items/${encodeURIComponent(line.id)}`, { method: "DELETE" });
  }
}

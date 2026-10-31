import { act, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { makeCart, makeCartLine } from "@hp/test-utils";
import { CartContents } from "@/components/cart/CartContents";
import { authStore } from "@/lib/auth-store";
import { cartQueryKey } from "@/lib/cart";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";

setupMockApi();

const guestCart = makeCart([makeCartLine({ productName: "Guest Whisk" })], { id: "cart_guest" });
const accountCart = makeCart([makeCartLine({ productName: "Account Dutch Oven" })], {
  id: "cart_account",
});

const SESSION = {
  accessToken: "mock-access-77",
  user: {
    id: "u_ada",
    email: "ada@example.test",
    firstName: "Ada",
    lastName: "Cook",
    role: "CUSTOMER" as const,
    emailVerified: true,
  },
};

/** The API answers per credential: bearer → the account's cart, none → the guest cookie cart. */
function cartPerCredential(requests: string[]) {
  server.use(
    http.get(`${API_URL}/cart`, ({ request }) => {
      const auth = request.headers.get("authorization");
      requests.push(auth ?? "guest");
      return HttpResponse.json({
        success: true,
        data: auth ? accountCart : guestCart,
        error: null,
      });
    }),
  );
}

beforeEach(() => authStore.reset());

describe("cart and the session (D-03)", () => {
  it("waits for the session to settle after a page load, then shows the account's cart", async () => {
    const requests: string[] = [];
    cartPerCredential(requests);
    // Fresh page load: the silent refresh has not finished when /cart mounts.
    renderWithProviders(<CartContents variant="page" />, undefined, { settleAuth: false });
    expect(requests).toEqual([]);

    act(() => authStore.setSession(SESSION));

    expect(await screen.findByText("Account Dutch Oven")).toBeInTheDocument();
    expect(screen.queryByText("Guest Whisk")).not.toBeInTheDocument();
    expect(requests).toEqual(["Bearer mock-access-77"]);
  });

  it("refetches under the account's key when a guest signs in", async () => {
    const requests: string[] = [];
    cartPerCredential(requests);
    authStore.clear();
    const { client } = renderWithProviders(<CartContents variant="page" />);
    expect(await screen.findByText("Guest Whisk")).toBeInTheDocument();

    act(() => authStore.setSession(SESSION));

    expect(await screen.findByText("Account Dutch Oven")).toBeInTheDocument();
    expect(client.getQueryData(cartQueryKey("u_ada"))).toMatchObject({ id: "cart_account" });
    expect(client.getQueryData(cartQueryKey(null))).toMatchObject({ id: "cart_guest" });
  });
});

describe("cartQueryKey", () => {
  it("scopes the cart cache to the signed-in user, or the guest", () => {
    expect(cartQueryKey("u_1")).toEqual(["cart", "u_1"]);
    expect(cartQueryKey(null)).toEqual(["cart", "guest"]);
  });
});

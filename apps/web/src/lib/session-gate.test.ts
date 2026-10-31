import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { Cart, ok } from "@hp/contracts";
import { createApiClient } from "@hp/api-client";
import { API_URL, server, setupMockApi } from "@/test/server";
import { browserApi, endpoints } from "./api";
import { authStore, whenSessionReady } from "./auth-store";

setupMockApi();

/** Authorization header of each POST /cart/items, as the API saw it. */
function recordCartAdds(): string[] {
  const seen: string[] = [];
  server.events.on("request:start", ({ request }) => {
    if (request.method === "POST" && request.url.endsWith("/cart/items")) {
      seen.push(request.headers.get("authorization") ?? "none");
    }
  });
  return seen;
}

beforeEach(() => {
  server.events.removeAllListeners();
  // A fresh page load: the silent refresh has not settled yet.
  authStore.reset();
});

describe("browser requests wait for the session (E2E Path 4 regression)", () => {
  it("an add-to-cart clicked before the refresh settles goes out with the customer's token", async () => {
    // The browser holds a refresh cookie from an earlier sign-in.
    await createApiClient(API_URL).post("/auth/login", {
      email: "ada@example.test",
      password: "correct horse",
    });
    authStore.reset();
    const seen = recordCartAdds();

    const cart = await browserApi.post(
      "/cart/items",
      { variantId: "v_sample_04_1", quantity: 1 },
      Cart,
    );

    expect(seen).toEqual([expect.stringMatching(/^Bearer mock-access-/)]);
    expect(authStore.getState()).toMatchObject({
      ready: true,
      user: { email: "ada@example.test" },
    });
    expect(cart.data.items).toHaveLength(1);
  });

  it("a signed-out shopper's request proceeds as a guest once the refresh settles", async () => {
    const seen = recordCartAdds();

    await browserApi.post("/cart/items", { variantId: "v_sample_04_1", quantity: 1 }, Cart);

    expect(seen).toEqual(["none"]);
    expect(authStore.getState()).toMatchObject({ ready: true, user: null });
  });

  it("whenSessionReady resolves at once when the session is already known", async () => {
    authStore.clear();
    let settled = false;
    const done = whenSessionReady().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(true);
    await done;
  });

  it("typed endpoints wait too: an owner's status check carries the token, not a lookup token", async () => {
    await createApiClient(API_URL).post("/auth/login", {
      email: "ada@example.test",
      password: "correct horse",
    });
    authStore.reset();

    const { data } = await endpoints.checkout.status({ number: "HP-2026-000001" });

    expect(data).toEqual({ status: "DELIVERED" });
  });

  it("PUT goes through the same gate", async () => {
    const seen: string[] = [];
    server.use(
      http.put(`${API_URL}/gate-probe`, ({ request }) => {
        seen.push(request.headers.get("authorization") ?? "none");
        return HttpResponse.json(ok({ done: true }));
      }),
    );

    const { data } = await browserApi.put("/gate-probe", {});

    expect(data).toEqual({ done: true });
    expect(seen).toEqual(["none"]);
    expect(authStore.getState().ready).toBe(true);
  });
});

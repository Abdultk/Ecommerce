import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { makePublicUser } from "@hp/test-utils";
import { authStore } from "./auth-store";
import { clearCacheOnSessionChange } from "./session-cache";

const session = (id: string) => ({
  accessToken: `token-${id}`,
  user: makePublicUser({ id }),
});

describe("clearCacheOnSessionChange", () => {
  afterEach(() => authStore.reset());

  it("drops cached data when the signed-in customer signs out or another signs in", () => {
    const client = new QueryClient();
    const stop = clearCacheOnSessionChange(client);

    authStore.setSession(session("u_a"));
    client.setQueryData(["cart"], { lines: ["A's skillet"] });
    authStore.setUser({ ...session("u_a").user, firstName: "Renamed" });
    expect(client.getQueryData(["cart"])).toBeDefined(); // same person: keep

    authStore.clear();
    expect(client.getQueryData(["cart"])).toBeUndefined();

    authStore.setSession(session("u_a"));
    client.setQueryData(["guest-order", "HP-2026-000001"], { email: "a@example.test" });
    authStore.setSession(session("u_b"));
    expect(client.getQueryData(["guest-order", "HP-2026-000001"])).toBeUndefined();
    stop();
  });

  it("keeps the guest's cart when they sign in", () => {
    const client = new QueryClient();
    const stop = clearCacheOnSessionChange(client);
    client.setQueryData(["cart"], { lines: ["guest whisk"] });

    authStore.setSession(session("u_a"));
    expect(client.getQueryData(["cart"])).toBeDefined();
    stop();
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";
import { fail, ok, paged } from "@hp/contracts";
import { ApiClientError, createApiClient, type TokenSource } from "../src/index";

const BASE = "http://api.test/api/v1";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const Item = z.object({ id: z.string() });

describe("successful requests", () => {
  it("returns data and meta from the envelope", async () => {
    server.use(
      http.get(`${BASE}/items`, () =>
        HttpResponse.json(paged([{ id: "a" }], { page: 1, pageSize: 24, total: 1 })),
      ),
    );
    const result = await createApiClient(BASE).get("/items", z.array(Item));
    expect(result.data).toEqual([{ id: "a" }]);
    expect(result.meta?.totalPages).toBe(1);
  });

  it("sends JSON bodies, credentials and extra headers", async () => {
    let seen: { body: unknown; key: string | null; type: string | null } | undefined;
    server.use(
      http.post(`${BASE}/items`, async ({ request }) => {
        seen = {
          body: await request.json(),
          key: request.headers.get("Idempotency-Key"),
          type: request.headers.get("Content-Type"),
        };
        return HttpResponse.json(ok({ id: "new" }));
      }),
    );
    const { data } = await createApiClient(BASE).post("/items", { name: "Wok" }, Item, {
      "Idempotency-Key": "k1",
    });
    expect(data).toEqual({ id: "new" });
    expect(seen).toEqual({ body: { name: "Wok" }, key: "k1", type: "application/json" });
  });

  it("supports PATCH and DELETE", async () => {
    server.use(
      http.patch(`${BASE}/items/a`, () => HttpResponse.json(ok({ id: "a" }))),
      http.delete(`${BASE}/items/a`, () => HttpResponse.json(ok(null))),
    );
    const client = createApiClient(BASE);
    expect((await client.patch("/items/a", { name: "x" }, Item)).data.id).toBe("a");
    expect((await client.delete("/items/a", z.null())).data).toBeNull();
  });

  it("skips validation when no schema is given", async () => {
    server.use(http.get(`${BASE}/raw`, () => HttpResponse.json(ok({ anything: 1 }))));
    expect((await createApiClient(BASE).get<{ anything: number }>("/raw")).data.anything).toBe(1);
  });
});

describe("errors", () => {
  it("throws ApiClientError with the API's error code and status", async () => {
    server.use(
      http.get(`${BASE}/items/x`, () =>
        HttpResponse.json(fail("NOT_FOUND", "Product not found."), { status: 404 }),
      ),
    );
    const err = await createApiClient(BASE)
      .get("/items/x", Item)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND", message: "Product not found." });
  });

  it("rejects a response whose data does not match the schema", async () => {
    server.use(http.get(`${BASE}/items/bad`, () => HttpResponse.json(ok({ id: 42 }))));
    const err = await createApiClient(BASE)
      .get("/items/bad", Item)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "INTERNAL", status: 200 });
    expect((err as ApiClientError).message).toMatch(/unexpected response/i);
  });

  it("handles non-JSON error pages from proxies", async () => {
    server.use(
      http.get(`${BASE}/down`, () => new HttpResponse("<html>Bad gateway</html>", { status: 502 })),
    );
    const err = await createApiClient(BASE)
      .get("/down")
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "INTERNAL" });
  });

  it("reports network failures with status 0", async () => {
    server.use(http.get(`${BASE}/offline`, () => HttpResponse.error()));
    const err = await createApiClient(BASE)
      .get("/offline")
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "INTERNAL" });
    expect((err as ApiClientError).message).toMatch(/can't reach/i);
  });
});

describe("authentication", () => {
  function tokens(
    initial: string | null,
    refreshed: string | null,
  ): TokenSource & { refresh: ReturnType<typeof vi.fn> } {
    let current = initial;
    return {
      get: () => current,
      refresh: vi.fn(async () => {
        current = refreshed;
        return refreshed;
      }),
    };
  }

  it("sends the bearer token", async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${BASE}/me`, ({ request }) => {
        auth = request.headers.get("Authorization");
        return HttpResponse.json(ok({ id: "u1" }));
      }),
    );
    await createApiClient(BASE, tokens("t1", null)).get("/me", Item);
    expect(auth).toBe("Bearer t1");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    server.use(
      http.get(`${BASE}/me`, ({ request }) =>
        request.headers.get("Authorization") === "Bearer fresh"
          ? HttpResponse.json(ok({ id: "u1" }))
          : HttpResponse.json(fail("UNAUTHENTICATED", "Expired."), { status: 401 }),
      ),
    );
    const source = tokens("stale", "fresh");
    const { data } = await createApiClient(BASE, source).get("/me", Item);
    expect(data.id).toBe("u1");
    expect(source.refresh).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent 401s", async () => {
    server.use(
      http.get(`${BASE}/me`, ({ request }) =>
        request.headers.get("Authorization") === "Bearer fresh"
          ? HttpResponse.json(ok({ id: "u1" }))
          : HttpResponse.json(fail("UNAUTHENTICATED", "Expired."), { status: 401 }),
      ),
    );
    const source = tokens("stale", "fresh");
    const client = createApiClient(BASE, source);
    await Promise.all([client.get("/me", Item), client.get("/me", Item), client.get("/me", Item)]);
    expect(source.refresh).toHaveBeenCalledTimes(1);
  });

  it("gives up when refresh fails", async () => {
    server.use(
      http.get(`${BASE}/me`, () =>
        HttpResponse.json(fail("UNAUTHENTICATED", "Expired."), { status: 401 }),
      ),
    );
    const source = tokens("stale", null);
    const err = await createApiClient(BASE, source)
      .get("/me", Item)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("does not try to refresh on the auth endpoints themselves", async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json(fail("UNAUTHENTICATED", "Wrong password."), { status: 401 }),
      ),
    );
    const source = tokens(null, "fresh");
    await createApiClient(BASE, source)
      .post("/auth/login", {})
      .catch(() => undefined);
    expect(source.refresh).not.toHaveBeenCalled();
  });
});

describe("client options", () => {
  it("adds default headers (sync or async) to every request; per-call headers win", async () => {
    const seen: Record<string, string | null>[] = [];
    server.use(
      http.all(`${BASE}/items`, ({ request }) => {
        seen.push({
          token: request.headers.get("X-Internal-Token"),
          key: request.headers.get("Idempotency-Key"),
        });
        return HttpResponse.json(ok({ id: "a" }));
      }),
    );
    const sync = createApiClient(BASE, undefined, {
      headers: () => ({ "X-Internal-Token": "t1" }),
    });
    await sync.get("/items", Item);
    const asyncHeaders = createApiClient(BASE, undefined, {
      headers: async () => ({ "X-Internal-Token": "t2", "Idempotency-Key": "default" }),
    });
    await asyncHeaders.post("/items", {}, Item, { "Idempotency-Key": "per-call" });
    expect(seen).toEqual([
      { token: "t1", key: null },
      { token: "t2", key: "per-call" },
    ]);
  });

  it("aborts a request that outlives timeoutMs and reports it like a network failure", async () => {
    server.use(
      http.get(`${BASE}/slow`, async () => {
        await delay(500);
        return HttpResponse.json(ok({ id: "late" }));
      }),
    );
    const err = await createApiClient(BASE, undefined, { timeoutMs: 20 })
      .get("/slow")
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "INTERNAL" });
  });
});

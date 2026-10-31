// @vitest-environment node
// Server-only code: runs under Node (as in production), where fetch accepts AbortSignal.timeout.
import { readFileSync } from "node:fs";
import path from "node:path";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Category, fail } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { API_URL, server, setupMockApi } from "@/test/server";
import { browserApi } from "./api";
import { getCategories, getProduct } from "./catalog";
import {
  clientIpFrom,
  catalogReadHeaders,
  clientIpSourceFrom,
  createServerApiClient,
  internalApiHeaders,
  SERVER_API_TIMEOUT_MS,
} from "./internal-api";

setupMockApi();

const TOKEN = "t".repeat(40);

afterEach(() => vi.unstubAllEnvs());

const CF = { header: "cf-connecting-ip" } as const;
const XFF = (trustedHops: number) => ({ header: "x-forwarded-for", trustedHops }) as const;
const NONE = { header: "none" } as const;

/** Everything a client can set on a request that bypasses Cloudflare. */
const spoofed = (extra: Record<string, string> = {}) =>
  new Headers({
    "x-forwarded-for": "6.6.6.6",
    "x-real-ip": "6.6.6.7",
    "true-client-ip": "6.6.6.8",
    ...extra,
  });

// getLocale reads the request's locale cookie; outside a request it has nothing to read.
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

describe("clientIpFrom: cf-connecting-ip mode (production default)", () => {
  it("reads only Cloudflare's header, which Cloudflare overwrites", () => {
    expect(clientIpFrom(spoofed({ "cf-connecting-ip": "203.0.113.7" }), CF)).toBe("203.0.113.7");
    expect(clientIpFrom(new Headers({ "cf-connecting-ip": "2001:db8::1" }), CF)).toBe(
      "2001:db8::1",
    );
  });

  it("never falls back to other headers when Cloudflare's is absent or invalid (M2)", () => {
    expect(clientIpFrom(spoofed(), CF)).toBeNull();
    // (CR/LF values never get this far: the Headers API rejects them outright.)
    expect(clientIpFrom(spoofed({ "cf-connecting-ip": "203.0.113.7; DROP" }), CF)).toBeNull();
    expect(clientIpFrom(spoofed({ "cf-connecting-ip": "unknown" }), CF)).toBeNull();
  });
});

describe("clientIpFrom: x-forwarded-for mode", () => {
  it("takes the entry the trusted proxies appended, not the client-controlled first one", () => {
    const chain = new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.1, 10.0.0.2" });
    expect(clientIpFrom(chain, XFF(1))).toBe("10.0.0.2");
    expect(clientIpFrom(chain, XFF(2))).toBe("198.51.100.1");
    // A single entry (e2e: no proxy in front of next start) with one hop.
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 10.1.2.3 " }), XFF(1))).toBe("10.1.2.3");
  });

  it("ignores other headers and refuses chains shorter than the hop count or non-IP entries", () => {
    expect(clientIpFrom(spoofed({ "x-forwarded-for": "198.51.100.1" }), XFF(1))).toBe(
      "198.51.100.1",
    );
    expect(clientIpFrom(new Headers({ "cf-connecting-ip": "203.0.113.7" }), XFF(1))).toBeNull();
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.1" }), XFF(2))).toBeNull();
    expect(
      clientIpFrom(new Headers({ "x-forwarded-for": "1.2.3.4, localhost" }), XFF(1)),
    ).toBeNull();
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "1.2.3.4,," }), XFF(1))).toBeNull();
  });
});

describe("clientIpFrom: none mode", () => {
  it("forwards nothing, so the API rate-limits on its own req.ip", () => {
    expect(clientIpFrom(spoofed({ "cf-connecting-ip": "203.0.113.7" }), NONE)).toBeNull();
  });
});

describe("clientIpSourceFrom", () => {
  it("defaults to Cloudflare's header and one trusted hop", () => {
    expect(clientIpSourceFrom({})).toEqual(CF);
    expect(clientIpSourceFrom({ CLIENT_IP_HEADER: "x-forwarded-for" })).toEqual(XFF(1));
    expect(
      clientIpSourceFrom({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "2" }),
    ).toEqual(XFF(2));
    expect(clientIpSourceFrom({ CLIENT_IP_HEADER: "none" })).toEqual(NONE);
  });

  it("rejects anything else rather than guessing", () => {
    expect(() => clientIpSourceFrom({ CLIENT_IP_HEADER: "x-real-ip" })).toThrow(/CLIENT_IP_HEADER/);
    expect(() =>
      clientIpSourceFrom({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "0" }),
    ).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(() =>
      clientIpSourceFrom({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "one" }),
    ).toThrow(/TRUSTED_PROXY_HOPS/);
  });
});

describe("internalApiHeaders", () => {
  const request = new Headers({ "cf-connecting-ip": "203.0.113.7" });

  it("sends the token and the shopper's IP when configured", () => {
    expect(internalApiHeaders(TOKEN, request, CF)).toEqual({
      "X-Internal-Token": TOKEN,
      "X-HP-Client-IP": "203.0.113.7",
    });
  });

  it("sends only the token without a usable IP (sitemap regeneration, none mode)", () => {
    expect(internalApiHeaders(TOKEN, null, CF)).toEqual({ "X-Internal-Token": TOKEN });
    expect(internalApiHeaders(TOKEN, request, NONE)).toEqual({ "X-Internal-Token": TOKEN });
  });

  it("sends nothing when the token is not configured (dev)", () => {
    expect(internalApiHeaders(undefined, request, CF)).toEqual({});
    expect(internalApiHeaders("", request, CF)).toEqual({});
  });
});

describe("createServerApiClient", () => {
  it("adds the internal headers to every catalog read and validates the payload", async () => {
    const seen: (string | null)[][] = [];
    server.events.on("request:start", ({ request }) => {
      seen.push([request.headers.get("x-internal-token"), request.headers.get("x-hp-client-ip")]);
    });
    const api = createServerApiClient(API_URL, async () => ({
      "X-Internal-Token": TOKEN,
      "X-HP-Client-IP": "203.0.113.7",
    }));

    const categories = await getCategories(api);
    server.events.removeAllListeners();

    expect(z.array(Category).safeParse(categories).success).toBe(true);
    expect(seen).toEqual([[TOKEN, "203.0.113.7"]]);
  });

  it("keeps ApiClientError semantics: 404 → null product, other failures throw", async () => {
    const api = createServerApiClient(API_URL, async () => ({}));
    expect(await getProduct(api, "no-such-pan")).toBeNull();

    server.use(
      http.get(`${API_URL}/categories`, () =>
        HttpResponse.json(fail("INTERNAL", "Boom"), { status: 500 }),
      ),
    );
    await expect(getCategories(api)).rejects.toMatchObject({ status: 500, message: "Boom" });

    server.use(
      http.get(`${API_URL}/categories`, () => HttpResponse.json({ success: true, data: [{}] })),
    );
    await expect(getCategories(api)).rejects.toBeInstanceOf(ApiClientError);

    server.use(http.get(`${API_URL}/categories`, () => HttpResponse.error()));
    await expect(getCategories(api)).rejects.toMatchObject({ status: 0 });

    server.use(
      http.get(`${API_URL}/categories`, () => new HttpResponse("<html>", { status: 502 })),
    );
    await expect(getCategories(api)).rejects.toMatchObject({ status: 502 });
  });
});

describe("client-side code", () => {
  it("never sends the internal token or a client IP, even if the variable is set", async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", TOKEN);
    const seen: string[] = [];
    server.events.on("request:start", ({ request }) => {
      seen.push(...[...request.headers.keys()].filter((k) => /internal|client-ip/i.test(k)));
    });
    await browserApi.get("/categories");
    server.events.removeAllListeners();
    expect(seen).toEqual([]);
  });

  it("keeps the server client behind a server-only guard", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), "src/lib", file), "utf8");
    expect(read("server-api.ts").trimStart().startsWith('import "server-only";')).toBe(true);
    expect(read("internal-api.ts")).toMatch(/^import "server-only";/);
  });
});

describe("which server reads send which headers (D-04 caching)", () => {
  it("cacheable catalog reads send the token only, never a shopper IP", async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", TOKEN);
    vi.stubEnv("CLIENT_IP_HEADER", "x-forwarded-for");
    const seen: Record<string, string | null>[] = [];
    server.events.on("request:start", ({ request }) => {
      seen.push({
        token: request.headers.get("x-internal-token"),
        ip: request.headers.get("x-hp-client-ip"),
      });
    });
    const { serverApi } = await import("./server-api");

    await getCategories(serverApi);
    server.events.removeAllListeners();

    expect(seen).toEqual([{ token: TOKEN, ip: null }]);
  });

  it("sends nothing extra in dev when no token is configured", () => {
    expect(catalogReadHeaders(undefined)).toEqual({});
    expect(catalogReadHeaders(TOKEN)).toEqual({ "X-Internal-Token": TOKEN });
  });

  it("gives every server read a bounded timeout", () => {
    expect(SERVER_API_TIMEOUT_MS).toBe(10_000);
  });
});

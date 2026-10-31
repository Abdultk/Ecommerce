import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { fail } from "@hp/contracts";
import { createApiClient } from "@hp/api-client";
import { API_URL, server, setupMockApi } from "@/test/server";
import { buildRobots } from "./robots";
import { buildSitemap } from "./sitemap";

setupMockApi();
const api = createApiClient(API_URL);
const productUrls = (urls: string[]) => urls.filter((u) => u.includes("/p/"));

describe("buildSitemap", () => {
  it("pages through the catalog and lists canonical URLs only", async () => {
    const urls = (await buildSitemap(api, { pageSize: 3 })).map((e) => e.url);
    expect(urls[0]).toBe("http://localhost:3000/");
    expect(productUrls(urls)).toHaveLength(8);
    expect(urls.some((u) => u.includes("?"))).toBe(false);
  });

  it("stops at the page cap", async () => {
    const urls = (await buildSitemap(api, { pageSize: 3, maxPages: 2 })).map((e) => e.url);
    expect(productUrls(urls)).toHaveLength(6);
  });

  it("fails when a later page fails, so ISR keeps serving the last good sitemap", async () => {
    server.use(
      http.get(`${API_URL}/products`, ({ request }) =>
        new URL(request.url).searchParams.get("page") === "2"
          ? HttpResponse.json(fail("INTERNAL", "down"), { status: 500 })
          : undefined,
      ),
    );
    await expect(buildSitemap(api, { pageSize: 3 })).rejects.toMatchObject({ status: 500 });
  });

  it("still lists the static pages when the API is down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(http.get(`${API_URL}/*`, () => HttpResponse.error()));
    const urls = (await buildSitemap(api)).map((e) => e.url);
    expect(urls).toEqual(["http://localhost:3000/", "http://localhost:3000/shop"]);
    warn.mockRestore();
  });
});

describe("buildRobots", () => {
  it("keeps private and per-user pages out of the index and points at the sitemap", () => {
    const robots = buildRobots("https://www.hearthandpan.com");
    const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    expect(rules?.disallow).toEqual(
      expect.arrayContaining([
        "/account",
        "/cart",
        "/checkout",
        "/orders/",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
      ]),
    );
    expect(robots.sitemap).toBe("https://www.hearthandpan.com/sitemap.xml");
  });
});

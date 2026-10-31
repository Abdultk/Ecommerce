import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  budgetFor,
  evaluateBudgets,
  firstLoadFiles,
  parseAppBuildManifest,
  routeOf,
} from "./bundle-budget";

const manifest = {
  pages: {
    "/layout": ["static/chunks/main.js", "static/chunks/layout.js", "static/css/app.css"],
    "/(shop)/layout": ["static/chunks/shop-layout.js"],
    "/(shop)/p/[slug]/page": ["static/chunks/main.js", "static/chunks/pdp.js"],
    "/checkout/page": ["static/chunks/main.js", "static/chunks/checkout.js"],
    "/sitemap.xml/route": ["static/chunks/main.js"],
    "/_not-found/page": ["static/chunks/main.js"],
  },
};

describe("routeOf", () => {
  it("turns manifest page keys into URL routes", () => {
    expect(routeOf("/(shop)/p/[slug]/page")).toBe("/p/[slug]");
    expect(routeOf("/page")).toBe("/");
    expect(routeOf("/checkout/page")).toBe("/checkout");
  });
});

describe("firstLoadFiles", () => {
  it("includes every ancestor layout's JS, de-duplicated, and no CSS", () => {
    expect(firstLoadFiles(manifest.pages, "/(shop)/p/[slug]/page")).toEqual([
      "static/chunks/main.js",
      "static/chunks/layout.js",
      "static/chunks/shop-layout.js",
      "static/chunks/pdp.js",
    ]);
  });
});

describe("budgets", () => {
  it("gives product pages their own budget and others the default", () => {
    expect(budgetFor("/p/[slug]")).toBe(BUDGETS.product);
    expect(budgetFor("/account/orders")).toBe(BUDGETS.default);
  });

  it("reports routes over budget, skipping route handlers and internal pages", () => {
    const sizes: Record<string, number> = {
      "static/chunks/main.js": 100 * 1024,
      "static/chunks/layout.js": 40 * 1024,
      "static/chunks/shop-layout.js": 10 * 1024,
      "static/chunks/pdp.js": 41 * 1024,
      "static/chunks/checkout.js": 10 * 1024,
    };
    const report = evaluateBudgets(manifest, (file) => sizes[file] ?? 0);
    expect(report.map((r) => r.route)).toEqual(["/checkout", "/p/[slug]"]);
    expect(report.find((r) => r.route === "/p/[slug]")).toMatchObject({
      bytes: 191 * 1024,
      over: true,
    });
    expect(report.find((r) => r.route === "/checkout")?.over).toBe(false);
  });
});

describe("parseAppBuildManifest", () => {
  it("rejects a manifest in an unexpected shape", () => {
    expect(() => parseAppBuildManifest({ nope: true })).toThrow();
    expect(parseAppBuildManifest(manifest).pages["/checkout/page"]).toHaveLength(2);
  });
});

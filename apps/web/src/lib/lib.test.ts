import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "@hp/contracts";
import { ApiClientError, createApiClient } from "@hp/api-client";
import { makeCart, makeCartLine, makeCategoryTree } from "@hp/test-utils";
import { API_URL, server, setupMockApi } from "@/test/server";
import { authStore, refreshSession, signOut } from "./auth-store";
import { applyOptimisticAdd, cartErrorMessage, cartItemCount } from "./cart";
import { getCategories, getFacets, getProduct, getProducts, orFallback } from "./catalog";
import { findCategory, flattenCategories } from "./category-tree";
import { readFields, safeRedirect, validateForm } from "./forms";
import { breadcrumbJsonLd, productJsonLd, serializeJsonLd } from "./json-ld";
import { DEFAULT_QUERY } from "./query";
import { buildSitemap } from "./sitemap";
import { LoginInput, ProductDetail } from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";

setupMockApi();
const api = createApiClient(API_URL);

describe("catalog reads", () => {
  it("pages products through the API with the query string", async () => {
    const { products, meta } = await getProducts(api, {
      ...DEFAULT_QUERY,
      sort: "price_asc",
      pageSize: 3,
    });
    expect(products).toHaveLength(3);
    expect(products[0]!.fromPriceCents).toBeLessThanOrEqual(products[1]!.fromPriceCents);
    expect(meta).toEqual({ page: 1, pageSize: 3, total: 8, totalPages: 3 });
  });

  it("returns null for a 404 product and rethrows other failures", async () => {
    expect(await getProduct(api, "no-such-pan")).toBeNull();
    expect((await getProduct(api, "chefs-knife-8in"))?.name).toBe("Chef's Knife 8\"");

    server.use(
      http.get(`${API_URL}/products/:slug`, () =>
        HttpResponse.json(fail("INTERNAL", "Boom"), { status: 500 }),
      ),
    );
    await expect(getProduct(api, "chefs-knife-8in")).rejects.toBeInstanceOf(ApiClientError);
  });

  it("reads categories and facets, and tolerates missing facets", async () => {
    expect((await getCategories(api)).map((c) => c.slug)).toContain("cookware");
    const facets = await getFacets(api, { ...DEFAULT_QUERY, category: "skillets" });
    expect(facets?.brands).toEqual([{ value: "Ironvale", count: 1 }]);

    server.use(
      http.get(`${API_URL}/products/facets`, () =>
        HttpResponse.json(fail("NOT_FOUND", "nope"), { status: 404 }),
      ),
    );
    expect(await getFacets(api, DEFAULT_QUERY)).toBeNull();
  });

  it("orFallback swaps a failure for the fallback and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await orFallback(Promise.reject(new Error("down")), [], "thing")).toEqual([]);
    expect(await orFallback(Promise.resolve([1]), [], "thing")).toEqual([1]);
    expect(warn).toHaveBeenCalledWith("[catalog] thing unavailable: down");
    warn.mockRestore();
  });
});

describe("sitemap", () => {
  it("lists static pages, every category and every product", async () => {
    const entries = await buildSitemap(api);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("http://localhost:3000/shop");
    expect(urls).toContain("http://localhost:3000/c/dutch-ovens");
    expect(urls).toContain("http://localhost:3000/p/cast-iron-skillet-10in");
    expect(urls.filter((u) => u.includes("/p/"))).toHaveLength(8);
  });
});

describe("category tree", () => {
  const tree = makeCategoryTree();
  it("finds nested categories with their parent", () => {
    expect(findCategory(tree, "skillets")?.parent?.slug).toBe("cookware");
    expect(findCategory(tree, "cookware")?.parent).toBeNull();
    expect(findCategory(tree, "nope")).toBeNull();
    expect(flattenCategories(tree)).toHaveLength(13);
  });
});

describe("cart helpers", () => {
  const preview = {
    productSlug: "chefs-knife-8in",
    productName: "Chef's Knife",
    variantName: "8 inch",
    sku: "BR-CK8",
    thumbnailUrl: null,
    unitPriceCents: 8900,
    stockAvailable: 30,
  };

  it("adds a new optimistic line to an empty cart", () => {
    const cart = applyOptimisticAdd(undefined, {
      variantId: "v1",
      quantity: 2,
      preview,
      currency: "KWD",
    });
    // Before the first server cart exists, the store currency labels the optimistic one.
    expect(cart.currency).toBe("KWD");
    expect(cart.items[0]).toMatchObject({ variantId: "v1", quantity: 2, lineTotalCents: 17800 });
    expect(cart.totals).toMatchObject({ subtotalCents: 17800, totalCents: 17800 });
    expect(cartItemCount(cart)).toBe(2);
  });

  it("bumps an existing line and keeps shipping in the total, without mutating the input", () => {
    const line = makeCartLine({ variantId: "v1", unitPriceCents: 1000, quantity: 1 });
    const before = makeCart([line], { shippingCents: 500 });
    const after = applyOptimisticAdd(before, {
      variantId: "v1",
      quantity: 2,
      preview,
      currency: "KWD",
    });
    expect(after.currency).toBe(before.currency);
    expect(after.items[0]).toMatchObject({ quantity: 3, lineTotalCents: 3000 });
    expect(after.totals.totalCents).toBe(3500);
    expect(before.items[0]!.quantity).toBe(1);
    expect(cartItemCount(undefined)).toBe(0);
  });

  it("maps errors to friendly messages", () => {
    expect(
      cartErrorMessage(new ApiClientError(409, { code: "OUT_OF_STOCK", message: "Only 2 left." })),
    ).toBe("Only 2 left.");
    expect(cartErrorMessage(new Error("x"))).toMatch(/couldn't add/);
  });
});

describe("auth store", () => {
  beforeEach(() => authStore.reset());

  it("restores a session via the refresh cookie, or clears when signed out", async () => {
    expect(await refreshSession()).toBeNull();
    expect(authStore.getState()).toMatchObject({ user: null, ready: true });

    await api.post("/auth/login", { email: "ada@example.test", password: "pw" });
    const token = await refreshSession();
    expect(token).toMatch(/^mock-access-/);
    expect(authStore.getState().user?.email).toBe("ada@example.test");
  });

  it("shares one in-flight refresh and notifies subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = authStore.subscribe(listener);
    const [a, b] = [refreshSession(), refreshSession()];
    expect(a).toBe(b);
    await a;
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("signs out locally even if the server call fails", async () => {
    authStore.setSession({
      accessToken: "t",
      user: {
        id: "u",
        email: "a@example.test",
        firstName: "A",
        lastName: "B",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    server.use(http.post(`${API_URL}/auth/logout`, () => HttpResponse.error()));
    await expect(signOut()).rejects.toBeInstanceOf(ApiClientError);
    expect(authStore.getToken()).toBeNull();
    expect(authStore.getServerState().ready).toBe(false);
  });
});

describe("forms", () => {
  it("returns parsed data or the first error per field", () => {
    expect(validateForm(LoginInput, { email: " ADA@Example.test ", password: "x" })).toEqual({
      success: true,
      data: { email: "ada@example.test", password: "x" },
    });
    expect(validateForm(LoginInput, { email: "", password: "" })).toEqual({
      success: false,
      errors: { email: "Enter a valid email address.", password: "Enter your password." },
    });
  });

  it("reads named fields from a form", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="email" value="a@b.test"><input name="other" value="x">';
    expect(readFields(form, ["email", "password"])).toEqual({ email: "a@b.test", password: "" });
  });

  it("only allows same-site relative redirects", () => {
    expect(safeRedirect("/cart")).toBe("/cart");
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("/\\evil.example")).toBe("/");
    expect(safeRedirect("https://evil.example")).toBe("/");
    // Browsers drop tabs and newlines from URLs, turning these into //evil.example.
    expect(safeRedirect("/\t/evil.example")).toBe("/");
    expect(safeRedirect("/\n/evil.example")).toBe("/");
    expect(safeRedirect("/\r\\evil.example")).toBe("/");
    expect(safeRedirect("/account/orders?page=2#top")).toBe("/account/orders?page=2#top");
    expect(safeRedirect(undefined, "/home")).toBe("/home");
  });
});

describe("JSON-LD", () => {
  it("escapes < so a name cannot close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("describes a product with offers, availability and rating", () => {
    const product = ProductDetail.parse(sampleCatalog()[1]);
    const ld = productJsonLd(product, "https://shop.test/p/x", "OMR");
    expect(ld.brand).toEqual({ "@type": "Brand", name: "Northfold" });
    expect(ld.description).toBe("Heavy enameled cast iron for braises, stews and bread.");
    expect(ld.offers.map((o) => [o.price, o.availability])).toEqual([
      ["21.900", "https://schema.org/InStock"],
      ["21.900", "https://schema.org/OutOfStock"],
    ]);
    // Two-decimal currencies keep two decimals.
    expect(productJsonLd(product, "u", "USD").offers[0]?.price).toBe("219.00");
    expect(ld.aggregateRating?.reviewCount).toBe(412);

    const noRating = productJsonLd(
      { ...product, ratingCount: 0, brand: null, material: null },
      "u",
      "OMR",
    );
    expect(noRating.aggregateRating).toBeUndefined();
    expect(noRating.brand).toBeUndefined();
  });

  it("numbers breadcrumb positions from 1", () => {
    const ld = breadcrumbJsonLd([
      { name: "Home", url: "https://shop.test/" },
      { name: "Skillets", url: "https://shop.test/c/skillets" },
    ]);
    expect(ld.itemListElement[1]).toMatchObject({ position: 2, name: "Skillets" });
  });
});

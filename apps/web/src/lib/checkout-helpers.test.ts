import { afterEach, describe, expect, it } from "vitest";
import { makeCart, makeCartLine } from "@hp/test-utils";
import { checkoutReturnUrl, createIdempotencyKeys, safePaymentRedirect } from "./checkout";
import { cancellable, orderStatusLabel, paymentMethodLabel } from "./orders";
import {
  setCartNotice,
  setPendingOrder,
  stashPendingOrderForRedirect,
  takeCartNotice,
  takePendingOrder,
} from "./handoff";
import { takeHashParam, takeQueryParam, takeUrlSecret } from "./url-secrets";

const input = (
  method: "standard" | "express",
  paymentMethod: "card" | "bank_transfer" = "card",
) => ({
  email: "ada@example.test",
  shippingAddress: {
    fullName: "Ada Cook",
    line1: "Al Khuwair, Way 3021",
    city: "Bawshar",
    region: "MA",
    postalCode: "133",
    country: "OM" as const,
    phone: "+96891234567",
  },
  shippingMethod: method,
  paymentMethod,
});

const cart = (quantity: number, overrides: Parameters<typeof makeCart>[1] = {}) =>
  makeCart(
    [
      makeCartLine({ variantId: "v_a", quantity, unitPriceCents: 1000 }),
      makeCartLine({ variantId: "v_b", quantity: 1, unitPriceCents: 500 }),
    ],
    overrides,
  );

describe("createIdempotencyKeys", () => {
  it("reuses one key while the checkout input and cart are unchanged", () => {
    const keys = createIdempotencyKeys();
    const first = keys.keyFor(input("standard"), cart(1));
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
    expect(keys.keyFor(input("standard"), cart(1))).toBe(first);
  });

  it("starts a new attempt when the input changes", () => {
    const keys = createIdempotencyKeys();
    const first = keys.keyFor(input("standard"), cart(1));
    const express = keys.keyFor(input("express"), cart(1));
    expect(express).not.toBe(first);
    expect(keys.keyFor(input("express", "bank_transfer"), cart(1))).not.toBe(express);
  });

  it("starts a new attempt when cart lines or totals change", () => {
    const keys = createIdempotencyKeys();
    const first = keys.keyFor(input("standard"), cart(1));
    const moreSkillets = keys.keyFor(input("standard"), cart(2));
    expect(moreSkillets).not.toBe(first);
    const withCoupon = keys.keyFor(input("standard"), cart(2, { discountCents: 300 }));
    expect(withCoupon).not.toBe(moreSkillets);
  });

  it("forgets the key after a failed attempt so the retry starts fresh", () => {
    const keys = createIdempotencyKeys();
    const first = keys.keyFor(input("standard"), cart(1));
    keys.reset();
    const retry = keys.keyFor(input("standard"), cart(1));
    expect(retry).not.toBe(first);
    expect(keys.keyFor(input("standard"), cart(1))).toBe(retry);
  });

  it("ignores line order and display-only fields", () => {
    const keys = createIdempotencyKeys();
    const base = cart(1);
    const first = keys.keyFor(input("standard"), base);
    const reordered = {
      ...base,
      items: [...base.items].reverse().map((l) => ({ ...l, productName: "x" })),
    };
    expect(keys.keyFor(input("standard"), reordered)).toBe(first);
  });
});

describe("checkout helpers", () => {
  it("builds the return URL with the order number only, never the lookup token", () => {
    expect(checkoutReturnUrl("https://shop.test", "HP-2026-001001")).toBe(
      "https://shop.test/checkout/return?number=HP-2026-001001",
    );
  });

  it("only follows https payment redirects (http only to localhost outside production)", () => {
    const ok = "https://api.example.com/api/v1/checkout/amwal-pay/abc.def";
    expect(safePaymentRedirect(ok, false)).toBe(ok);
    expect(safePaymentRedirect(ok, true)).toBe(ok);
    expect(safePaymentRedirect("http://localhost:3000/checkout/return?number=1", false)).toBe(
      "http://localhost:3000/checkout/return?number=1",
    );
    expect(safePaymentRedirect("http://127.0.0.1:4000/dev/pay", false)).toBe(
      "http://127.0.0.1:4000/dev/pay",
    );
    expect(safePaymentRedirect("http://localhost:3000/x", true)).toBeNull();
    expect(safePaymentRedirect("http://pay.example.test/x", false)).toBeNull();
    expect(safePaymentRedirect("javascript:alert(1)", false)).toBeNull();
    expect(safePaymentRedirect("not a url", false)).toBeNull();
  });

  it("labels statuses and knows which can be cancelled", () => {
    expect(orderStatusLabel("PENDING_PAYMENT")).toBe("Awaiting payment");
    expect(orderStatusLabel("PENDING_PAYMENT", "card")).toBe("Awaiting payment");
    expect(orderStatusLabel("PENDING_PAYMENT", "bank_transfer")).toBe("Awaiting bank transfer");
    expect(orderStatusLabel("PAID", "bank_transfer")).toBe("Paid");
    expect(paymentMethodLabel("bank_transfer")).toBe("Bank transfer");
    expect(paymentMethodLabel("card")).toBe("Card");
    expect(cancellable("PAID")).toBe(true);
    expect(cancellable("PENDING_PAYMENT")).toBe(true);
    expect(cancellable("SHIPPED")).toBe(false);
  });
});

describe("handoff", () => {
  it("hands a pending order over exactly once", () => {
    setPendingOrder({ orderNumber: "HP-2026-001001", lookupToken: "t".repeat(32) });
    expect(takePendingOrder("HP-2026-001001")?.lookupToken).toBe("t".repeat(32));
    expect(takePendingOrder("HP-2026-001001")).toBeNull();
  });

  it("ignores a pending order for a different number", () => {
    setPendingOrder({ orderNumber: "HP-2026-001001", lookupToken: "t".repeat(32) });
    expect(takePendingOrder("HP-2026-009999")).toBeNull();
  });

  it("keeps a stashed order across a full-page redirect, once, then clears storage", () => {
    stashPendingOrderForRedirect({ orderNumber: "HP-2026-001002", lookupToken: "s".repeat(32) });
    expect(window.location.href).not.toContain("s".repeat(32));
    expect(takePendingOrder("HP-2026-001002")?.lookupToken).toBe("s".repeat(32));
    expect(window.sessionStorage.length).toBe(0);
    expect(takePendingOrder("HP-2026-001002")).toBeNull();
  });

  it("drops a stashed order for a different number and ignores corrupt storage", () => {
    stashPendingOrderForRedirect({ orderNumber: "HP-2026-001002", lookupToken: "s".repeat(32) });
    expect(takePendingOrder("HP-2026-009999")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);

    window.sessionStorage.setItem("hp:pending-order", "{not json");
    expect(takePendingOrder("HP-2026-001002")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("hands the cart notice over exactly once", () => {
    setCartNotice("Only 1 left.");
    expect(takeCartNotice()).toBe("Only 1 left.");
    expect(takeCartNotice()).toBeNull();
  });
});

describe("url secrets", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("reads a query token and strips it from the address bar", () => {
    window.history.replaceState(null, "", "/reset-password?token=secret-value&x=1");
    expect(takeQueryParam("token")).toBe("secret-value");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.href).not.toContain("secret-value");
  });

  it("reads a hash token and strips the fragment", () => {
    window.history.replaceState(null, "", "/orders/HP-2026-000001#token=hash-secret");
    expect(takeHashParam("token")).toBe("hash-secret");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/orders/HP-2026-000001");
  });

  it("prefers the fragment, falls back to the query, and scrubs both", () => {
    window.history.replaceState(null, "", "/reset-password?token=old&x=1#token=new");
    expect(takeUrlSecret("token")).toBe("new");
    expect(window.location.href).not.toMatch(/old|new/);
    expect(window.location.search).toBe("?x=1");

    window.history.replaceState(null, "", "/verify-email?token=legacy");
    expect(takeUrlSecret("token")).toBe("legacy");
    expect(window.location.pathname + window.location.search).toBe("/verify-email");

    window.history.replaceState(null, "", "/verify-email#other=1");
    expect(takeUrlSecret("token")).toBeNull();
  });

  it("returns null when the param is absent", () => {
    expect(takeQueryParam("token")).toBeNull();
    expect(takeHashParam("token")).toBeNull();
  });
});

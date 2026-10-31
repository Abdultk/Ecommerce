import { describe, expect, it } from "vitest";
import { AdminProductListItem } from "@hp/contracts";
import { formatDate, orderStatusLabel, paymentMethodLabel, roleLabel, toInt } from "@/lib/format";
import { patchSearch } from "@/lib/url-state";
import { buildCsp, staticSecurityHeaders } from "@/lib/security-headers";
import { buildAdminProductRows } from "@test/mocks/products";

describe("formatDate / roleLabel", () => {
  it("formats an ISO timestamp as a short UTC date", () => {
    expect(formatDate("2026-10-01T12:00:00.000Z")).toBe("Oct 1, 2026");
  });

  it("humanises roles", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Super admin");
    expect(roleLabel("STAFF")).toBe("Staff");
  });

  it("names payment methods", () => {
    expect(paymentMethodLabel("card")).toBe("Card");
    expect(paymentMethodLabel("bank_transfer")).toBe("Bank transfer");
  });
});

describe("number inputs", () => {
  it("parses whole numbers", () => {
    expect(toInt(" 12 ")).toBe(12);
    expect(toInt("-3")).toBe(-3);
    expect(toInt("")).toBeNull();
    expect(toInt("1.5")).toBeNaN();
    expect(orderStatusLabel("PENDING_PAYMENT")).toBe("Pending payment");
  });
});

describe("patchSearch", () => {
  it("sets, removes and resets the page", () => {
    expect(patchSearch("page=3&status=PAID", { q: "pan" }, true)).toBe("status=PAID&q=pan");
    expect(patchSearch("status=PAID", { status: null, lowStock: false }, true)).toBe("");
    expect(patchSearch("q=pan", { page: 2 }, true)).toBe("q=pan&page=2");
  });
});

describe("security headers", () => {
  const csp = buildCsp({
    apiUrl: "https://api.hearthandpan.com/api/v1",
    nonce: "abc123",
    isDev: false,
    cdnUrl: "https://images.hearthandpan.com/products",
    uploadOrigin: "https://*.r2.cloudflarestorage.com",
  });

  it("builds a strict nonce-based CSP that only allows the API origin for fetches", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("connect-src 'self' https://api.hearthandpan.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("worker-src");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows product images from the CDN, and uploads to storage", () => {
    expect(csp).toContain("img-src 'self' data: blob: https://images.hearthandpan.com");
    expect(csp).toContain(
      "connect-src 'self' https://api.hearthandpan.com https://*.r2.cloudflarestorage.com",
    );
  });

  it("relaxes only what Next dev mode needs", () => {
    const dev = buildCsp({
      apiUrl: "http://localhost:4000/api/v1",
      nonce: "n",
      isDev: true,
      cdnUrl: "https://cdn.example.test",
      uploadOrigin: "",
    });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' http://localhost:4000 ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("sends the static hardening headers", () => {
    const headers = Object.fromEntries(staticSecurityHeaders().map((h) => [h.key, h.value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
});

describe("mock product rows", () => {
  it("are contract-valid and include drafts, archived and low-stock items", () => {
    const rows = buildAdminProductRows();
    expect(rows.length).toBeGreaterThanOrEqual(8);
    rows.forEach((r) => expect(AdminProductListItem.safeParse(r).success).toBe(true));
    expect(rows.some((r) => r.status === "DRAFT")).toBe(true);
    expect(rows.some((r) => r.status === "ARCHIVED")).toBe(true);
    expect(rows.some((r) => r.lowStock)).toBe(true);
  });
});

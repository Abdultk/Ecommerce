import { describe, expect, it } from "vitest";
import {
  AnalyticsRange,
  CategorySales,
  MAX_TOP_PRODUCTS,
  ReportJob,
  ReportJobQuery,
  ReportRequest,
  TopProductsQuery,
} from "../src/admin";
import { MAX_CART_LINES } from "../src/cart";

const NOW = "2026-10-10T12:00:00Z";

describe("TopProductsQuery", () => {
  it("defaults to the top 10 by revenue", () => {
    const q = TopProductsQuery.parse({ from: "2026-09-01", to: "2026-09-30" });
    expect(q.by).toBe("revenue");
    expect(q.limit).toBe(10);
    expect(q.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("coerces the limit from a query string and caps it", () => {
    const base = { from: "2026-09-01", to: "2026-09-30", by: "units" };
    expect(TopProductsQuery.parse({ ...base, limit: "25" }).limit).toBe(25);
    expect(
      TopProductsQuery.safeParse({ ...base, limit: String(MAX_TOP_PRODUCTS + 1) }).success,
    ).toBe(false);
    expect(TopProductsQuery.safeParse({ ...base, limit: "0" }).success).toBe(false);
  });

  it("applies the same range rules as AnalyticsRange", () => {
    expect(TopProductsQuery.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success).toBe(
      false,
    );
    expect(TopProductsQuery.safeParse({ from: "2024-01-01", to: "2026-01-01" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown ranking", () => {
    const q = { from: "2026-09-01", to: "2026-09-30", by: "profit" };
    expect(TopProductsQuery.safeParse(q).success).toBe(false);
  });
});

describe("AnalyticsRange (unchanged behaviour)", () => {
  it("still parses and defaults the interval", () => {
    expect(AnalyticsRange.parse({ from: "2026-09-01", to: "2026-09-30" }).interval).toBe("day");
  });
});

describe("CategorySales", () => {
  it("describes revenue and units per category", () => {
    const row = {
      categoryId: "c1",
      name: "Cookware",
      orders: 3,
      unitsSold: 5,
      revenueCents: 12_000,
    };
    expect(CategorySales.parse(row)).toEqual(row);
    expect(CategorySales.safeParse({ ...row, revenueCents: -1 }).success).toBe(false);
  });
});

describe("reports", () => {
  const job = {
    id: "r1",
    type: "orders",
    format: "csv",
    status: "done",
    range: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
    rowCount: 12,
    error: null,
    downloadUrl: "https://files.example.test/reports/r1.csv?sig=abc",
    downloadExpiresAt: NOW,
    requestedByEmail: "admin@example.test",
    createdAt: NOW,
    completedAt: NOW,
  };

  it("parses a finished job with its download link", () => {
    expect(ReportJob.parse(job)).toEqual(job);
  });

  it("allows a queued job without a link", () => {
    const queued = {
      ...job,
      status: "queued",
      rowCount: null,
      downloadUrl: null,
      downloadExpiresAt: null,
      completedAt: null,
    };
    expect(ReportJob.parse(queued).downloadUrl).toBeNull();
  });

  it("refuses non-http download links", () => {
    expect(ReportJob.safeParse({ ...job, downloadUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("accepts each report type and format", () => {
    for (const type of ["orders", "sales-by-day", "inventory", "customers"]) {
      for (const format of ["csv", "xlsx"]) {
        const req = { type, format, range: { from: "2026-09-01", to: "2026-09-30" } };
        expect(ReportRequest.safeParse(req).success).toBe(true);
      }
    }
    const bad = { type: "secrets", format: "csv", range: { from: "2026-09-01", to: "2026-09-30" } };
    expect(ReportRequest.safeParse(bad).success).toBe(false);
  });

  it("pages the job list", () => {
    expect(ReportJobQuery.parse({})).toEqual({ page: 1, pageSize: 24 });
    expect(ReportJobQuery.safeParse({ pageSize: "500" }).success).toBe(false);
  });
});

describe("cart limits", () => {
  it("caps the number of distinct lines in a cart", () => {
    expect(MAX_CART_LINES).toBe(50);
  });
});

describe("AnalyticsRange date-only flag (code review #6)", () => {
  it("marks a date-only end so the API can include the whole day", () => {
    const r = AnalyticsRange.parse({ from: "2026-09-01", to: "2026-09-30" });
    expect(r.toDateOnly).toBe(true);
    expect(r.to.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("treats an exact-midnight timestamp as a timestamp, not a date", () => {
    const r = AnalyticsRange.parse({ from: "2026-09-01", to: "2026-09-30T00:00:00Z" });
    expect(r.toDateOnly).toBe(false);
    expect(
      TopProductsQuery.parse({ from: "2026-09-01", to: "2026-09-30T00:00:00Z" }).toDateOnly,
    ).toBe(false);
  });

  it("still rejects impossible dates and reversed ranges on `to`", () => {
    const bad = AnalyticsRange.safeParse({ from: "2026-09-01", to: "2026-02-30" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["to"]);
    expect(AnalyticsRange.safeParse({ from: "2026-09-01", to: "nope" }).success).toBe(false);
    expect(AnalyticsRange.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success).toBe(false);
  });
});

describe("expired reports (security review M6)", () => {
  it("allows the expired status without a link", () => {
    const expired = {
      id: "r1",
      type: "orders",
      format: "csv",
      status: "expired",
      range: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
      rowCount: 3,
      error: null,
      downloadUrl: null,
      downloadExpiresAt: null,
      requestedByEmail: null,
      createdAt: NOW,
      completedAt: NOW,
    };
    expect(ReportJob.parse(expired).status).toBe("expired");
  });
});

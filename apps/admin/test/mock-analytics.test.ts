import { describe, expect, it } from "vitest";
import {
  AnalyticsSummary,
  CategorySales,
  ReportJob,
  SalesPoint,
  TopProduct,
  type Role,
} from "@hp/contracts";
import { z } from "zod";
import { mockSessionFor } from "@test/mocks/accounts";
import { API } from "./server";

// Contract-level checks of the analytics and report-job mocks.

type StaffRole = Exclude<Role, "CUSTOMER">;
type Envelope = { success: boolean; data: unknown; error: { code: string } | null };

async function call(method: string, path: string, role?: StaffRole, body?: unknown) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (role) headers.Authorization = `Bearer ${mockSessionFor(role).accessToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Envelope };
}

const WEEK = "from=2026-10-05T00:00:00.000Z&to=2026-10-11T23:59:59.999Z";

describe("analytics mock", () => {
  it("needs analytics:read", async () => {
    expect((await call("GET", `/admin/analytics/summary?${WEEK}`, "STAFF")).status).toBe(403);
    expect((await call("GET", `/admin/analytics/summary?${WEEK}`)).status).toBe(401);
  });

  it("rejects a reversed range with the contract's message", async () => {
    const res = await call(
      "GET",
      "/admin/analytics/summary?from=2026-10-11&to=2026-10-01",
      "ADMIN",
    );
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns a summary that matches the daily series, with the previous period", async () => {
    const summary = AnalyticsSummary.parse(
      (await call("GET", `/admin/analytics/summary?${WEEK}`, "ADMIN")).json.data,
    );
    const series = z
      .array(SalesPoint)
      .parse((await call("GET", `/admin/analytics/sales-timeseries?${WEEK}`, "ADMIN")).json.data);
    expect(series).toHaveLength(7);
    expect(series[0]?.bucket).toBe("2026-10-05T00:00:00.000Z");
    expect(summary.current.revenueCents).toBe(series.reduce((s, p) => s + p.revenueCents, 0));
    expect(summary.current.orders).toBe(series.reduce((s, p) => s + p.orders, 0));
    expect(summary.previous.orders).toBeGreaterThan(0);
    expect(summary.current.lowStockSkus).toBe(3);
    expect(summary.current.newCustomers + summary.current.returningCustomers).toBe(
      summary.current.orders,
    );
  });

  it("buckets by week and month", async () => {
    const q = "from=2026-08-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z";
    const weeks = z
      .array(SalesPoint)
      .parse(
        (await call("GET", `/admin/analytics/sales-timeseries?${q}&interval=week`, "ADMIN")).json
          .data,
      );
    const months = z
      .array(SalesPoint)
      .parse(
        (await call("GET", `/admin/analytics/sales-timeseries?${q}&interval=month`, "ADMIN")).json
          .data,
      );
    expect(weeks[0]?.bucket).toBe("2026-07-27T00:00:00.000Z"); // the Monday of that week
    expect(weeks).toHaveLength(10);
    expect(months.map((m) => m.bucket)).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ]);
  });

  it("ranks top products by revenue and honours the limit", async () => {
    const rows = z
      .array(TopProduct)
      .parse(
        (await call("GET", `/admin/analytics/top-products?${WEEK}&limit=3`, "ADMIN")).json.data,
      );
    expect(rows).toHaveLength(3);
    expect(rows[0]!.revenueCents).toBeGreaterThanOrEqual(rows[1]!.revenueCents);
  });

  it("returns sales by category", async () => {
    const rows = z
      .array(CategorySales)
      .parse((await call("GET", `/admin/analytics/sales-by-category?${WEEK}`, "ADMIN")).json.data);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("report jobs mock", () => {
  const request = {
    type: "orders",
    format: "csv",
    range: { from: "2026-10-01", to: "2026-10-11" },
  };

  it("needs analytics:export and a valid request", async () => {
    expect((await call("POST", "/admin/reports", "STAFF", request)).status).toBe(403);
    const bad = await call("POST", "/admin/reports", "ADMIN", { ...request, format: "pdf" });
    expect(bad.status).toBe(400);
  });

  it("queues a job that runs, finishes with a download link and shows in the list", async () => {
    const created = await call("POST", "/admin/reports", "ADMIN", request);
    expect(created.status).toBe(202);
    const job = ReportJob.parse(created.json.data);
    expect(job.status).toBe("queued");

    const poll = async () =>
      ReportJob.parse((await call("GET", `/admin/reports/${job.id}`, "ADMIN")).json.data);
    expect((await poll()).status).toBe("running");
    const done = await poll();
    expect(done.status).toBe("done");
    expect(done.downloadUrl).toMatch(/^https:\/\/.+\.csv$/);

    const list = z.array(ReportJob).parse((await call("GET", "/admin/reports", "ADMIN")).json.data);
    expect(list[0]).toMatchObject({ id: job.id, type: "orders", format: "csv" });
    expect(job.range).toEqual({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-12T00:00:00.000Z", // a date-only end is exclusive: the next midnight
    });
    expect(job.requestedByEmail).toBe("admin@hearthandpan.test");
  });

  it("lists only the caller's jobs unless they are a super admin", async () => {
    await call("POST", "/admin/reports", "SUPER_ADMIN", request);
    const ids = async (role: StaffRole) =>
      z
        .array(ReportJob)
        .parse((await call("GET", "/admin/reports", role)).json.data)
        .map((j) => j.id);
    expect(await ids("ADMIN")).toEqual(["rep_seed_2", "rep_seed_1", "rep_seed_0"]);
    expect(await ids("SUPER_ADMIN")).toHaveLength(4);
  });

  it("ranks top products by units when asked", async () => {
    const rows = z
      .array(TopProduct)
      .parse(
        (await call("GET", `/admin/analytics/top-products?${WEEK}&by=units`, "ADMIN")).json.data,
      );
    expect(rows[0]!.unitsSold).toBeGreaterThanOrEqual(rows[1]!.unitsSold);
  });

  it("is a 404 for an unknown job", async () => {
    expect((await call("GET", "/admin/reports/rep_nope", "ADMIN")).status).toBe(404);
  });
});

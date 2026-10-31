import { http } from "msw";
import { AnalyticsRange, TopProductsQuery } from "@hp/contracts";
import { daySpan, salesByCategory, salesSeries, summaryFor, topProducts } from "../analytics-data";
import { authorize, invalid, okResponse, queryOf, type MockContext } from "../http";
import type { MockDb } from "../types";
import { toInventoryItem } from "./stock-coupons";

// Mirrors apps/api/src/modules/admin/analytics.admin.ts (all analytics:read).

function lowStockCount(db: MockDb): number {
  return db.products
    .filter((p) => p.status !== "ARCHIVED")
    .flatMap((p) => p.variants.map((v) => toInventoryItem(p, v)))
    .filter((r) => r.isActive && r.lowStock).length;
}

/** Authorizes and validates the shared ?from&to&interval query. */
function parseRange(ctx: MockContext, request: Request) {
  const caller = authorize(ctx, request, "analytics:read");
  if (caller instanceof Response) return caller;
  const { from, to, interval } = queryOf(request);
  const range = AnalyticsRange.safeParse({ from, to, interval });
  if (!range.success) return invalid(range.error);
  return { ...range.data, span: daySpan(range.data.from, range.data.to) };
}

export function analyticsRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;
  const base = `${baseUrl}/admin/analytics`;

  return [
    http.get(`${base}/summary`, ({ request }) => {
      const range = parseRange(ctx, request);
      if (range instanceof Response) return range;
      const db = store.get();
      return okResponse(summaryFor(range.span, lowStockCount(db), db.settings.currency));
    }),

    http.get(`${base}/sales-timeseries`, ({ request }) => {
      const range = parseRange(ctx, request);
      if (range instanceof Response) return range;
      return okResponse(salesSeries(range.span, range.interval));
    }),

    http.get(`${base}/top-products`, ({ request }) => {
      const caller = authorize(ctx, request, "analytics:read");
      if (caller instanceof Response) return caller;
      const query = TopProductsQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const span = daySpan(query.data.from, query.data.to);
      return okResponse(topProducts(store.get(), span, query.data.limit, query.data.by));
    }),

    http.get(`${base}/sales-by-category`, ({ request }) => {
      const range = parseRange(ctx, request);
      if (range instanceof Response) return range;
      return okResponse(salesByCategory(store.get(), range.span));
    }),
  ];
}

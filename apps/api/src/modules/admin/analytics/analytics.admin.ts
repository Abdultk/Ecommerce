import { Router } from "express";
import { AnalyticsRange, TopProductsQuery, ok, type AnalyticsSummary } from "@hp/contracts";
import { prisma } from "../../../lib/prisma";
import { requirePermission } from "../../../middleware/authenticate";
import { currencyOf, loadSettings } from "../../settings/settings.service";
import {
  lowStockSkuCount,
  periodKpis,
  salesByCategory,
  salesSeries,
  topProducts,
  type ResolvedRange,
} from "./analytics.queries";

const DAY_MS = 86_400_000;

/**
 * A date-only `to` ("YYYY-MM-DD") means "through the end of that day", so the exclusive end
 * is the next UTC midnight. A timestamp `to` is used as given (exclusive), even at midnight.
 */
export function resolveRange(range: { from: Date; to: Date; toDateOnly: boolean }): ResolvedRange {
  const end = range.toDateOnly ? new Date(range.to.getTime() + DAY_MS) : range.to;
  return { from: range.from, end };
}

/** The period of equal length that ends where this one starts. */
export const previousPeriod = (r: ResolvedRange): ResolvedRange => ({
  from: new Date(r.from.getTime() - (r.end.getTime() - r.from.getTime())),
  end: r.from,
});

/** /admin/analytics: read-only KPIs and series (analytics:read). Rules in analytics.queries.ts. */
export function analyticsAdminRouter(): Router {
  const router = Router();
  router.use(requirePermission("analytics:read"));

  router.get("/summary", async (req, res) => {
    const range = resolveRange(AnalyticsRange.parse(req.query));
    // Stock has no history, so both periods report today's low-stock count.
    const lowStock = await lowStockSkuCount(prisma);
    const [current, previous] = await Promise.all([
      periodKpis(prisma, range, lowStock),
      periodKpis(prisma, previousPeriod(range), lowStock),
    ]);
    const currency = currencyOf(await loadSettings(prisma));
    const summary: AnalyticsSummary = { current, previous, currency };
    res.json(ok(summary));
  });

  router.get("/sales-timeseries", async (req, res) => {
    const query = AnalyticsRange.parse(req.query);
    res.json(ok(await salesSeries(prisma, resolveRange(query), query.interval)));
  });

  router.get("/top-products", async (req, res) => {
    const query = TopProductsQuery.parse(req.query);
    res.json(ok(await topProducts(prisma, resolveRange(query), query.by, query.limit)));
  });

  router.get("/sales-by-category", async (req, res) => {
    res.json(ok(await salesByCategory(prisma, resolveRange(AnalyticsRange.parse(req.query)))));
  });

  return router;
}

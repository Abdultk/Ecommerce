"use client";

import { useQuery } from "@tanstack/react-query";
import { AnalyticsSummary, CategorySales, SalesPoint, TopProduct } from "@hp/contracts";
import { z } from "zod";
import { rangeQuery, type ApiRange } from "@/lib/analytics-range";
import { ANALYTICS_KEY } from "@/lib/query-keys";
import { useSession } from "@/lib/session";

// Read hooks for GET /admin/analytics/* (analytics:read). Every response is validated
// against the contract schema by the API client. A null range (invalid custom dates)
// disables the query instead of sending a request the API would reject.

const TOP_PRODUCTS_LIMIT = 10;

function useAnalyticsQuery<T>(
  endpoint: string,
  range: ApiRange | null,
  schema: z.ZodType<T>,
  extra = "",
) {
  const { api } = useSession();
  return useQuery({
    queryKey: [...ANALYTICS_KEY, endpoint, range, extra],
    queryFn: async () => {
      const { data } = await api.get(
        `/admin/analytics/${endpoint}?${rangeQuery(range!)}${extra}`,
        schema,
      );
      return data;
    },
    enabled: range !== null,
  });
}

export const useAnalyticsSummary = (range: ApiRange | null) =>
  useAnalyticsQuery("summary", range, AnalyticsSummary);

export const useSalesSeries = (range: ApiRange | null) =>
  useAnalyticsQuery("sales-timeseries", range, z.array(SalesPoint));

export const useTopProducts = (range: ApiRange | null) =>
  useAnalyticsQuery("top-products", range, z.array(TopProduct), `&limit=${TOP_PRODUCTS_LIMIT}`);

export const useSalesByCategory = (range: ApiRange | null) =>
  useAnalyticsQuery("sales-by-category", range, z.array(CategorySales));

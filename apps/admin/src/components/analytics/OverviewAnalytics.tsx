"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBucket } from "@/components/charts/chart-format";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { resolveRange } from "@/lib/analytics-range";
import { useMoneyFormat } from "@/lib/store-settings";
import { errorMessage } from "@/lib/session";
import { KpiGrid } from "./KpiGrid";
import { useAnalyticsSummary, useSalesSeries } from "./use-analytics";

const COMPARISON = "previous 30 days";

/** Overview KPIs and a 30-day revenue chart. Rendered only inside <Can perm="analytics:read">. */
export function OverviewAnalytics() {
  const [now] = useState(() => new Date());
  const resolved = resolveRange({ preset: "30d" }, "day", now);
  const range = resolved.ok ? resolved.range : null;
  const summary = useAnalyticsSummary(range);
  const series = useSalesSeries(range);
  const money = useMoneyFormat();
  const error = summary.error ?? series.error;

  return (
    <section aria-label="Last 30 days" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="eyebrow text-muted">Last 30 days</h2>
        <Link href="/analytics" className="btn-link text-sm">
          Open analytics
        </Link>
      </div>
      {error ? (
        <p role="alert" className="error-text panel p-4">
          {errorMessage(error)}
        </p>
      ) : (
        <>
          {summary.data ? (
            <KpiGrid summary={summary.data} comparison={COMPARISON} />
          ) : (
            <p className="panel p-4 text-sm text-muted">Loading key figures…</p>
          )}
          {series.data && (
            <TimeSeriesChart
              compact
              title="Revenue, last 30 days"
              kind="line"
              points={series.data.map((p) => ({
                label: formatBucket(p.bucket, "day"),
                value: p.revenueCents,
              }))}
              formatValue={money.format}
              formatAxis={money.compact}
              periodNoun="days"
            />
          )}
        </>
      )}
    </section>
  );
}

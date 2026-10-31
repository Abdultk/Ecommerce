"use client";

import { useState, type ReactNode } from "react";
import { AnalyticsInterval } from "@hp/contracts";
import { z } from "zod";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { PERIOD_NOUNS, formatBucket, formatCompactCount } from "@/components/charts/chart-format";
import { RANGE_PRESETS, resolveRange, type ApiRange } from "@/lib/analytics-range";
import { formatCount } from "@/lib/format";
import { useMoneyFormat } from "@/lib/store-settings";
import { errorMessage } from "@/lib/session";
import { useUrlQuery } from "@/lib/url-state";
import { CategorySalesTable, CustomerMix, TopProductsTable } from "./Breakdowns";
import { ExportButtons } from "./ExportButtons";
import { KpiGrid } from "./KpiGrid";
import { IntervalSwitch, RangeControls } from "./RangeControls";
import {
  useAnalyticsSummary,
  useSalesByCategory,
  useSalesSeries,
  useTopProducts,
} from "./use-analytics";

// Range and interval live in the URL (?range=30d&interval=week, or range=custom&from&to)
// so a view can be bookmarked; invalid values fall back to the last 30 days, daily.
const AnalyticsUrl = z.object({
  range: z.enum(RANGE_PRESETS).catch("30d"),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  interval: AnalyticsInterval.catch("day"),
});

/** Loading / error / data for one widget. */
function Loadable<T>({
  query,
  label,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined };
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isError) {
    return (
      <p role="alert" className="error-text panel p-4">
        {errorMessage(query.error)}
      </p>
    );
  }
  if (query.isPending || query.data === undefined) {
    return <p className="panel p-4 text-sm text-muted">Loading {label}…</p>;
  }
  return <>{children(query.data)}</>;
}

function Charts({ range }: { range: ApiRange }) {
  const series = useSalesSeries(range);
  const money = useMoneyFormat();
  const noun = PERIOD_NOUNS[range.interval];
  return (
    <Loadable query={series} label="charts">
      {(points) => {
        const label = (bucket: string) => formatBucket(bucket, range.interval);
        return (
          <div className="grid gap-4 xl:grid-cols-2">
            <TimeSeriesChart
              title="Revenue"
              kind="line"
              points={points.map((p) => ({ label: label(p.bucket), value: p.revenueCents }))}
              formatValue={money.format}
              formatAxis={money.compact}
              periodNoun={noun}
            />
            <TimeSeriesChart
              title="Orders"
              kind="bar"
              points={points.map((p) => ({ label: label(p.bucket), value: p.orders }))}
              formatValue={formatCount}
              formatAxis={formatCompactCount}
              periodNoun={noun}
            />
          </div>
        );
      }}
    </Loadable>
  );
}

function Report({ range, days }: { range: ApiRange; days: number }) {
  const summary = useAnalyticsSummary(range);
  const top = useTopProducts(range);
  const categories = useSalesByCategory(range);
  const comparison = `previous ${days} ${days === 1 ? "day" : "days"}`;
  return (
    <div className="space-y-6">
      <section aria-label="Key figures">
        <Loadable query={summary} label="key figures">
          {(data) => <KpiGrid summary={data} comparison={comparison} withMargin />}
        </Loadable>
      </section>
      <Charts range={range} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]">
        <Loadable query={top} label="top products">
          {(rows) => <TopProductsTable rows={rows} />}
        </Loadable>
        <Loadable query={categories} label="category sales">
          {(rows) => <CategorySalesTable rows={rows} />}
        </Loadable>
        {summary.data && <CustomerMix kpis={summary.data.current} />}
      </div>
    </div>
  );
}

/** Analytics: range presets, interval, KPIs vs the previous period, charts, breakdowns, export. */
export function AnalyticsDashboard() {
  const { query, update } = useUrlQuery(AnalyticsUrl);
  const [now] = useState(() => new Date());
  const resolved = resolveRange(
    { preset: query.range, from: query.from, to: query.to },
    query.interval,
    now,
  );
  const range = resolved.ok ? resolved.range : null;

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-end justify-between gap-4 p-4">
        <div className="flex flex-wrap items-end gap-6">
          <RangeControls
            selection={{ preset: query.range, from: query.from, to: query.to }}
            error={resolved.ok ? null : resolved.error}
            onChange={(next) =>
              update(
                next.preset === "custom"
                  ? { range: "custom", from: next.from, to: next.to }
                  : { range: next.preset, from: null, to: null },
              )
            }
          />
          <IntervalSwitch value={query.interval} onChange={(interval) => update({ interval })} />
        </div>
        <ExportButtons range={range} />
      </div>
      {resolved.ok && <Report range={resolved.range} days={resolved.days} />}
    </div>
  );
}

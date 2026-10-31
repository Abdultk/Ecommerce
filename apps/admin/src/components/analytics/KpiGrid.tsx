import { formatMoney, type AnalyticsSummary } from "@hp/contracts";
import { KpiCard } from "@/components/charts/KpiCard";
import { formatPercent, shareOf } from "@/lib/analytics-math";
import { formatCount } from "@/lib/format";

type KpiGridProps = {
  summary: AnalyticsSummary;
  /** e.g. "previous 30 days" */
  comparison: string;
  /** The overview shows the four headline KPIs; the analytics page adds gross margin. */
  withMargin?: boolean;
};

function marginNote(margin: number | null, revenue: number): string {
  if (margin === null) return "Add a cost to every variant to see margin.";
  return `${formatPercent(shareOf(margin, revenue))} of revenue`;
}

export function KpiGrid({ summary, comparison, withMargin = false }: KpiGridProps) {
  const { current, previous } = summary;
  const formatCents = (minor: number) => formatMoney(minor, summary.currency);
  const shared = { comparison };
  return (
    <div
      className={`grid gap-4 sm:grid-cols-2 ${withMargin ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}
    >
      <KpiCard
        {...shared}
        label="Revenue"
        value={formatCents(current.revenueCents)}
        current={current.revenueCents}
        previous={previous.revenueCents}
        emptyPrevious="No revenue in the previous period"
      />
      <KpiCard
        {...shared}
        label="Orders"
        value={formatCount(current.orders)}
        current={current.orders}
        previous={previous.orders}
        emptyPrevious="No orders in the previous period"
      />
      <KpiCard
        {...shared}
        label="Average order"
        value={formatCents(current.aovCents)}
        current={current.aovCents}
        previous={previous.aovCents}
        emptyPrevious="No orders in the previous period"
      />
      <KpiCard
        {...shared}
        label="Refund rate"
        value={formatPercent(current.refundRate)}
        current={current.refundRate}
        previous={previous.refundRate}
        emptyPrevious="No refunds in the previous period"
        higherIsBetter={false}
      />
      {withMargin && (
        <KpiCard
          {...shared}
          label="Gross margin"
          value={current.grossMarginCents === null ? null : formatCents(current.grossMarginCents)}
          current={current.grossMarginCents}
          previous={previous.grossMarginCents}
          emptyPrevious="No margin in the previous period"
          note={marginNote(current.grossMarginCents, current.revenueCents)}
        />
      )}
    </div>
  );
}

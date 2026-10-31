import { useId, type ReactNode } from "react";
import type { AnalyticsSummary, CategorySales, TopProduct } from "@hp/contracts";
import { formatPercent, shareOf } from "@/lib/analytics-math";
import { formatCount } from "@/lib/format";
import { useMoneyFormat } from "@/lib/store-settings";

// Tables and the customer mix under the charts. Names come from the database and are
// rendered as text, so markup in a product or category name is shown, never executed.

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="panel">
      <h2 id={id} className="eyebrow border-b border-line px-4 py-3 text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Proportion bar; decorative because the same share is in the text next to it. */
function ShareBar({ share }: { share: number }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full rounded bg-ink-200">
      <span
        className="block h-1.5 rounded bg-ember-600"
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </span>
  );
}

/**
 * Horizontal scroller for a wide table. Focusable so keyboard users can scroll it
 * (axe scrollable-region-focusable), and named so screen readers announce it.
 */
function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={`${label} (scrollable)`}
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-2"
    >
      {children}
    </div>
  );
}

export function TopProductsTable({ rows }: { rows: readonly TopProduct[] }) {
  const money = useMoneyFormat();
  return (
    <Panel title="Top products">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No products sold in this range.</p>
      ) : (
        <ScrollRegion label="Top products">
          <table className="data-table">
            <caption className="sr-only">Top products</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="text-right">
                  Units
                </th>
                <th scope="col" className="text-right">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.productId}>
                  <th scope="row" className="font-normal">
                    {p.name}
                  </th>
                  <td className="text-right tabular-nums">{formatCount(p.unitsSold)}</td>
                  <td className="text-right tabular-nums">{money.format(p.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Panel>
  );
}

export function CategorySalesTable({ rows }: { rows: readonly CategorySales[] }) {
  const total = rows.reduce((sum, r) => sum + r.revenueCents, 0);
  const money = useMoneyFormat();
  return (
    <Panel title="Sales by category">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No category sales in this range.</p>
      ) : (
        <ScrollRegion label="Sales by category">
          <table className="data-table">
            <caption className="sr-only">Sales by category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="text-right">
                  Orders
                </th>
                <th scope="col" className="text-right">
                  Revenue
                </th>
                <th scope="col">Share of revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const share = shareOf(r.revenueCents, total);
                return (
                  <tr key={r.categoryId}>
                    <th scope="row" className="font-normal">
                      {r.name}
                    </th>
                    <td className="text-right tabular-nums">{formatCount(r.orders)}</td>
                    <td className="text-right tabular-nums">{money.format(r.revenueCents)}</td>
                    <td className="min-w-32">
                      <span className="text-xs tabular-nums">{formatPercent(share)}</span>
                      <ShareBar share={share} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Panel>
  );
}

export function CustomerMix({ kpis }: { kpis: AnalyticsSummary["current"] }) {
  const total = kpis.newCustomers + kpis.returningCustomers;
  const newShare = shareOf(kpis.newCustomers, total);
  return (
    <Panel title="New vs returning customers">
      <div className="space-y-3 p-4 text-sm">
        <ShareBar share={newShare} />
        <p>
          New customers: {formatPercent(newShare)} ({formatCount(kpis.newCustomers)})
        </p>
        <p>
          Returning customers: {formatPercent(total > 0 ? 1 - newShare : 0)} (
          {formatCount(kpis.returningCustomers)})
        </p>
      </div>
    </Panel>
  );
}

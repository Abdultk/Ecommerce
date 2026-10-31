"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AdminOrderListItem, InventoryItem, formatMoney } from "@hp/contracts";
import { z } from "zod";
import { OverviewAnalytics } from "@/components/analytics/OverviewAnalytics";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { formatCount, formatDateTime, roleLabel } from "@/lib/format";
import { INVENTORY_KEY, ORDERS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { Can } from "./Can";
import { PageHeader } from "./PageHeader";

const LATEST_ORDERS = 10;

function LowStockCard() {
  const { api } = useSession();
  // pageSize=1: only the total in the page meta is needed.
  const query = useQuery({
    queryKey: [...INVENTORY_KEY, "low-stock-count"],
    queryFn: () => api.get("/admin/inventory?lowStock=true&pageSize=1", z.array(InventoryItem)),
  });
  const total = query.data?.meta?.total ?? 0;
  return (
    <section aria-labelledby="low-stock-title" className="panel p-4">
      <h2 id="low-stock-title" className="eyebrow text-muted">
        Inventory
      </h2>
      {query.isPending ? (
        <p className="mt-2 text-sm text-muted">Counting low-stock variants…</p>
      ) : query.isError ? (
        <p role="alert" className="error-text mt-2">
          {errorMessage(query.error)}
        </p>
      ) : (
        <Link href="/inventory?lowStock=true" className="tile mt-1 block rounded-md py-1 pr-8">
          <span className="block font-display text-4xl text-ink-950 tabular-nums">
            {formatCount(total)}
          </span>
          <span className="text-sm text-muted">
            {total === 1 ? "low-stock variant" : "low-stock variants"} at or below their threshold
          </span>
        </Link>
      )}
    </section>
  );
}

function LatestOrders() {
  const { api } = useSession();
  const query = useQuery({
    queryKey: [...ORDERS_KEY, "latest"],
    queryFn: () => api.get(`/admin/orders?pageSize=${LATEST_ORDERS}`, z.array(AdminOrderListItem)),
  });
  return (
    <section aria-labelledby="latest-title" className="panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="latest-title" className="eyebrow text-muted">
          Latest orders
        </h2>
        <Link href="/orders" className="btn-link text-sm">
          All orders
        </Link>
      </div>
      {query.isPending ? (
        <p className="px-4 py-6 text-sm text-muted">Loading orders…</p>
      ) : query.isError ? (
        <p role="alert" className="error-text m-4">
          {errorMessage(query.error)}
        </p>
      ) : query.data.data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <caption className="sr-only">Latest orders</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Placed</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-mono font-medium text-ink-950 hover:text-ember-700 hover:underline"
                    >
                      {o.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(o.createdAt)}</td>
                  <td>{o.customerName ?? o.email}</td>
                  <td>
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="text-right tabular-nums">
                    {formatMoney(o.totalCents, o.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Overview. Each widget is gated by the permission its endpoint needs: STAFF see stock and
 * orders; roles with analytics:read also get 30-day KPIs and the revenue chart.
 */
export function Overview() {
  const { user } = useSession();
  if (!user) return null;
  return (
    <>
      <PageHeader
        eyebrow={`${user.firstName} · ${roleLabel(user.role)}`}
        title="Overview"
        description="What needs attention today."
      />
      <Can perm="analytics:read">
        <div className="mb-6">
          <OverviewAnalytics />
        </div>
      </Can>
      <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Can perm="inventory:read">
          <LowStockCard />
        </Can>
        <Can perm="order:read">
          <LatestOrders />
        </Can>
      </div>
    </>
  );
}

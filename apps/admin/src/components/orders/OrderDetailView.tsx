"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AdminOrderDetail, OMAN_GOVERNORATES, formatMoney } from "@hp/contracts";
import { PageHeader } from "@/components/PageHeader";
import { formatCount, formatDateTime, orderStatusLabel } from "@/lib/format";
import { errorMessage, useSession } from "@/lib/session";
import { ConfirmTransferButton } from "./ConfirmTransferButton";
import { CancelOrderButton, RefundButton, StatusTransitionMenu } from "./OrderActions";
import { OrderPaymentPanel } from "./OrderPaymentPanel";
import { AwaitingTransferBadge, OrderStatusBadge, refundStateLabel } from "./OrderStatusBadge";
import { ORDERS_KEY, orderKey } from "@/lib/query-keys";

const SHIPPING_LABELS = { standard: "Standard", express: "Express" } as const;

/** "MA" → "Muscat"; older stored addresses keep whatever region they had. */
const regionName = (code: string): string =>
  OMAN_GOVERNORATES.find((g) => g.code === code)?.name ?? code;

export function OrderDetailView({ id }: { id: string }) {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: orderKey(id),
    queryFn: async () => (await api.get(`/admin/orders/${id}`, AdminOrderDetail)).data,
  });

  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading order…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="error-text max-w-xl">
        {errorMessage(query.error)}
      </p>
    );
  }

  const detail = query.data;
  const { order } = detail;
  const onUpdated = (next: AdminOrderDetail) => {
    queryClient.setQueryData(orderKey(id), next);
    void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
    setNotice(`Order updated: ${orderStatusLabel(next.order.status).toLowerCase()}.`);
  };
  const address = order.shippingAddress;
  const formatCents = (minor: number) => formatMoney(minor, order.currency);

  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title={order.number}
        description={
          <>
            Placed {formatDateTime(order.createdAt)} ·{" "}
            <Link href="/orders" className="btn-link">
              Back to orders
            </Link>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={order.status} />
        {order.paymentDueAt && <AwaitingTransferBadge dueAt={order.paymentDueAt} />}
        <span className="badge badge-neutral">{refundStateLabel(order.refundState)}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <ConfirmTransferButton detail={detail} onUpdated={onUpdated} />
          <StatusTransitionMenu detail={detail} onUpdated={onUpdated} />
          <CancelOrderButton detail={detail} onUpdated={onUpdated} />
          <RefundButton detail={detail} onUpdated={onUpdated} />
        </div>
      </div>
      {notice && (
        <p role="status" className="notice mb-4">
          {notice}
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Items">
            <div className="overflow-x-auto">
              <table className="data-table">
                <caption className="sr-only">Items</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="text-right">
                      Unit
                    </th>
                    <th scope="col" className="text-right">
                      Qty
                    </th>
                    <th scope="col" className="text-right">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.productName}
                        <span className="block text-xs text-muted">{item.variantName}</span>
                      </td>
                      <td className="font-mono text-xs">{item.sku}</td>
                      <td className="text-right tabular-nums">
                        {formatCents(item.unitPriceCents)}
                      </td>
                      <td className="text-right tabular-nums">{formatCount(item.quantity)}</td>
                      <td className="text-right tabular-nums">
                        {formatCents(item.lineTotalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 ml-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
              <Row label="Subtotal" value={formatCents(order.totals.subtotalCents)} />
              {order.totals.discountCents > 0 && (
                <Row
                  label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`}
                  value={`−${formatCents(order.totals.discountCents)}`}
                />
              )}
              <Row
                label={`Shipping (${SHIPPING_LABELS[order.shippingMethod]})`}
                value={formatCents(order.totals.shippingCents)}
              />
              <Row label="Tax" value={formatCents(order.totals.taxCents)} />
              <Row label="Total" value={formatCents(order.totals.totalCents)} strong />
              {order.refundedCents > 0 && (
                <Row label="Refunded" value={`−${formatCents(order.refundedCents)}`} />
              )}
              <Row label="Refundable" value={formatCents(detail.refundableCents)} />
            </dl>
          </Panel>

          {detail.refunds.length > 0 && (
            <Panel title="Refunds">
              <table className="data-table">
                <caption className="sr-only">Refunds</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">By</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Bank reference</th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.refunds.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-muted">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td>{r.actorEmail ?? "System"}</td>
                      <td>{r.reason ?? "—"}</td>
                      <td className="font-mono text-xs">{r.bankReference ?? "—"}</td>
                      <td className="text-right tabular-nums">{formatCents(r.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="Timeline">
            <ol aria-label="Timeline" className="space-y-3 border-l border-line-strong pl-4">
              {[...order.events].reverse().map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span
                    aria-hidden
                    className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-ember-600"
                  />
                  <span className="font-medium text-ink-950">
                    {e.toStatus ? orderStatusLabel(e.toStatus) : e.type.replace(/_/g, " ")}
                  </span>
                  {e.message && <span className="text-ink-800"> — {e.message}</span>}
                  <span className="block text-xs text-muted">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Customer">
            {detail.customer ? (
              <Link
                href={`/customers?q=${encodeURIComponent(detail.customer.email)}`}
                className="font-medium text-ink-950 hover:text-ember-700 hover:underline"
              >
                {detail.customer.name}
              </Link>
            ) : (
              <p className="font-medium text-ink-950">Guest checkout</p>
            )}
            <p className="text-sm text-muted">{order.email}</p>
          </Panel>
          <Panel title="Shipping address">
            <address className="text-sm not-italic">
              {[
                address.fullName,
                address.line1,
                address.line2,
                [`${address.city}, ${regionName(address.region)}`, address.postalCode]
                  .filter(Boolean)
                  .join(" "),
                address.phone,
              ]
                .filter((line): line is string => Boolean(line))
                .map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
            </address>
            {order.carrier && <p className="mt-2 text-sm">Courier: {order.carrier}</p>}
            {order.trackingNumber && (
              <p className="mt-2 text-sm">
                Tracking: <span className="font-mono">{order.trackingNumber}</span>
              </p>
            )}
            {order.estimatedDeliveryAt && (
              <p className="mt-2 text-sm">
                Expected delivery: {order.estimatedDeliveryAt.slice(0, 10)}
              </p>
            )}
          </Panel>
          <Panel title="Payment">
            <OrderPaymentPanel detail={detail} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-4" aria-label={title}>
      <h2 className="eyebrow mb-3 text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? "font-semibold text-ink-950" : "text-muted"}>{label}</dt>
      <dd className={`text-right ${strong ? "font-semibold text-ink-950" : ""}`}>{value}</dd>
    </>
  );
}

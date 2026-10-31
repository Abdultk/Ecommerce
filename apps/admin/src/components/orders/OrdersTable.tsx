"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import {
  AdminOrderListItem,
  AdminOrderQuery,
  OrderStatus,
  PAYMENT_METHODS,
  Page,
  PageSize,
  PaymentMethod,
  formatMoney,
} from "@hp/contracts";
import { z } from "zod";
import { DataTable } from "@/components/data-table/DataTable";
import { formatCount, formatDateTime, orderStatusLabel, paymentMethodLabel } from "@/lib/format";
import { ORDERS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { useUrlQuery } from "@/lib/url-state";
import { AwaitingTransferBadge, OrderStatusBadge } from "./OrderStatusBadge";

const Rows = z.array(AdminOrderListItem);

/** Lenient URL shape: bad values are dropped; the date range is checked by AdminOrderQuery. */
const OrderUrlQuery = z.object({
  status: OrderStatus.optional().catch(undefined),
  paymentMethod: PaymentMethod.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: z.string().optional(),
  to: z.string().optional(),
  page: Page.catch(1),
  pageSize: PageSize.catch(25),
});

const COLUMNS: ColumnDef<AdminOrderListItem>[] = [
  {
    accessorKey: "number",
    header: "Order",
    cell: ({ row }) => (
      <Link
        href={`/orders/${row.original.id}`}
        className="font-mono font-medium text-ink-950 hover:text-ember-700 hover:underline"
      >
        {row.original.number}
      </Link>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Placed",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted">{formatDateTime(row.original.createdAt)}</span>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) => (
      <div className="min-w-40">
        <span className="text-ink-950">{row.original.customerName ?? "Guest"}</span>
        <span className="block text-xs text-muted">{row.original.email}</span>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="flex flex-col items-start gap-1">
        <OrderStatusBadge status={row.original.status} />
        {row.original.paymentDueAt && <AwaitingTransferBadge dueAt={row.original.paymentDueAt} />}
      </span>
    ),
  },
  {
    accessorKey: "paymentMethod",
    header: "Payment",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {row.original.paymentLabel ?? paymentMethodLabel(row.original.paymentMethod)}
      </span>
    ),
  },
  {
    accessorKey: "itemCount",
    header: "Items",
    meta: { align: "right" },
    cell: ({ row }) => formatCount(row.original.itemCount),
  },
  {
    accessorKey: "totalCents",
    header: "Total",
    meta: { align: "right" },
    cell: ({ row }) => (
      <span>
        {formatMoney(row.original.totalCents, row.original.currency)}
        {row.original.refundedCents > 0 && (
          <span className="block text-xs text-muted">
            −{formatMoney(row.original.refundedCents, row.original.currency)} refunded
          </span>
        )}
      </span>
    ),
  },
];

export function OrdersTable() {
  const { api } = useSession();
  const ids = useId();
  const { query, update } = useUrlQuery(OrderUrlQuery);
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");

  const raw = Object.fromEntries(
    Object.entries({ ...query, page: String(query.page), pageSize: String(query.pageSize) }).filter(
      ([, v]) => v !== undefined && v !== "",
    ),
  ) as Record<string, string>;
  const valid = AdminOrderQuery.safeParse(raw);
  const apiQuery = new URLSearchParams(raw).toString();

  const result = useQuery({
    queryKey: [...ORDERS_KEY, apiQuery],
    queryFn: () => api.get(`/admin/orders?${apiQuery}`, Rows),
    placeholderData: keepPreviousData,
    enabled: valid.success,
  });

  const filterError = valid.success
    ? null
    : (valid.error.issues[0]?.message ?? "Check the filters.");
  const hasFilters = Boolean(
    query.status || query.paymentMethod || query.q || query.from || query.to,
  );

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update({ q: searchDraft.trim() });
  };

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <form role="search" onSubmit={handleSearch} className="flex min-w-60 flex-1 items-end gap-2">
        <div className="flex-1">
          <label htmlFor={`${ids}-q`} className="field-label">
            Search orders
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            value={searchDraft}
            maxLength={100}
            placeholder="Order number or email"
            onChange={(e) => setSearchDraft(e.target.value)}
            className="field field-compact"
          />
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      <div>
        <label htmlFor={`${ids}-status`} className="field-label">
          Status
        </label>
        <select
          id={`${ids}-status`}
          value={query.status ?? ""}
          onChange={(e) => update({ status: e.target.value })}
          className="field field-compact w-auto"
        >
          <option value="">All statuses</option>
          {OrderStatus.options.map((s) => (
            <option key={s} value={s}>
              {orderStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${ids}-payment`} className="field-label">
          Payment method
        </label>
        <select
          id={`${ids}-payment`}
          value={query.paymentMethod ?? ""}
          onChange={(e) => update({ paymentMethod: e.target.value })}
          className="field field-compact w-auto"
        >
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {paymentMethodLabel(m)}
            </option>
          ))}
        </select>
      </div>
      {(["from", "to"] as const).map((key) => (
        <div key={key}>
          <label htmlFor={`${ids}-${key}`} className="field-label">
            {key === "from" ? "From" : "To"}
          </label>
          <input
            id={`${ids}-${key}`}
            type="date"
            value={query[key] ?? ""}
            onChange={(e) => update({ [key]: e.target.value })}
            className="field field-compact w-auto"
          />
        </div>
      ))}
      {hasFilters && (
        <button
          type="button"
          className="btn btn-link"
          onClick={() => {
            setSearchDraft("");
            update({ status: null, paymentMethod: null, q: null, from: null, to: null });
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <DataTable
      caption="Orders"
      columns={COLUMNS}
      data={result.data?.data ?? []}
      getRowId={(row) => row.id}
      page={query.page}
      pageSize={query.pageSize}
      total={result.data?.meta?.total ?? 0}
      onPageChange={(page) => update({ page })}
      pageSizeOptions={[10, 25, 50, 100]}
      onPageSizeChange={(size) => update({ pageSize: size })}
      itemNoun="orders"
      isLoading={valid.success && result.isPending}
      isFetching={result.isFetching}
      error={filterError ?? (result.isError ? errorMessage(result.error) : null)}
      onRetry={filterError ? undefined : () => void result.refetch()}
      emptyMessage={hasFilters ? "No orders match these filters." : "No orders yet."}
      toolbar={toolbar}
    />
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { AdminProductListItem, AdminProductQuery, ProductStatus } from "@hp/contracts";
import { z } from "zod";
import { Can } from "@/components/Can";
import { DataTable } from "@/components/data-table/DataTable";
import { indentLabel, useCategories } from "@/lib/categories";
import { formatCount, formatDate, statusLabel } from "@/lib/format";
import { errorMessage, useSession } from "@/lib/session";
import { useMoneyFormat } from "@/lib/store-settings";
import { useUrlQuery } from "@/lib/url-state";
import { PRODUCTS_KEY } from "@/lib/query-keys";

const PAGE_SIZES = [5, 10, 25, 50] as const;
const Rows = z.array(AdminProductListItem);
type SortKey = z.infer<typeof AdminProductQuery>["sort"];

const STATUS_STYLES: Record<ProductStatus, string> = {
  ACTIVE: "badge-ok",
  DRAFT: "badge-neutral",
  ARCHIVED: "badge-muted",
};

// Column ids double as the API's sort keys; only those columns are sortable.
/** Catalog prices are in the store currency. */
function Money({ minor }: { minor: number }) {
  return <>{useMoneyFormat().format(minor)}</>;
}

const COLUMNS: ColumnDef<AdminProductListItem>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    enableSorting: true,
    cell: ({ row }) => (
      <div className="min-w-48">
        <Link
          href={`/products/${row.original.id}`}
          className="font-medium text-ink-950 hover:text-ember-700 hover:underline"
        >
          {row.original.name}
        </Link>
        <span className="block font-mono text-xs text-muted">{row.original.slug}</span>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className={`badge ${STATUS_STYLES[row.original.status]}`}>
        {statusLabel(row.original.status)}
      </span>
    ),
  },
  { accessorKey: "categoryName", header: "Category" },
  { accessorKey: "variantCount", header: "Variants", meta: { align: "right" } },
  {
    id: "price",
    accessorKey: "fromPriceCents",
    header: "Price from",
    enableSorting: true,
    meta: { align: "right" },
    cell: ({ row }) => <Money minor={row.original.fromPriceCents} />,
  },
  {
    id: "stock",
    accessorKey: "stockAvailable",
    header: "Available",
    enableSorting: true,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="inline-flex items-center justify-end gap-2">
        {row.original.lowStock && <span className="badge badge-warn">Low stock</span>}
        <span
          className={
            row.original.stockAvailable === 0 ? "font-semibold text-danger-700" : undefined
          }
        >
          {formatCount(row.original.stockAvailable)}
        </span>
      </span>
    ),
  },
  {
    id: "updatedAt",
    accessorKey: "updatedAt",
    header: "Updated",
    enableSorting: true,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted">{formatDate(row.original.updatedAt)}</span>
    ),
  },
];

type ProductsTableProps = { initialPageSize?: number };

export function ProductsTable({ initialPageSize = 25 }: ProductsTableProps) {
  const { api } = useSession();
  const ids = useId();
  const categories = useCategories();
  const { query, search, update } = useUrlQuery(AdminProductQuery);
  const pageSize = new URLSearchParams(search).has("pageSize") ? query.pageSize : initialPageSize;
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");

  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(pageSize),
    sort: query.sort,
    dir: query.dir,
  });
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.lowStock) params.set("lowStock", "true");
  const apiQuery = params.toString();

  const result = useQuery({
    queryKey: [...PRODUCTS_KEY, apiQuery],
    queryFn: () => api.get(`/admin/products?${apiQuery}`, Rows),
    placeholderData: keepPreviousData,
  });

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update({ q: searchDraft.trim() });
  };

  const clearFilters = () => {
    setSearchDraft("");
    update({ q: null, status: null, categoryId: null, lowStock: null });
  };

  const hasFilters = Boolean(query.q || query.status || query.categoryId || query.lowStock);
  const pageSizes = PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
    ? PAGE_SIZES
    : [...PAGE_SIZES, pageSize].sort((a, b) => a - b);

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <form role="search" onSubmit={handleSearch} className="flex min-w-60 flex-1 items-end gap-2">
        <div className="flex-1">
          <label htmlFor={`${ids}-q`} className="field-label">
            Search products
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            value={searchDraft}
            maxLength={100}
            placeholder="Name or slug"
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
          {ProductStatus.options.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${ids}-category`} className="field-label">
          Category
        </label>
        <select
          id={`${ids}-category`}
          value={query.categoryId ?? ""}
          onChange={(e) => update({ categoryId: e.target.value })}
          className="field field-compact w-auto max-w-56"
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {indentLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={Boolean(query.lowStock)}
          onChange={(e) => update({ lowStock: e.target.checked })}
          className="check"
        />
        Low stock only
      </label>
      {hasFilters && (
        <button type="button" className="btn btn-link" onClick={clearFilters}>
          Clear filters
        </button>
      )}
      <Can perm="product:write">
        <Link href="/products/new" className="btn btn-primary ml-auto">
          New product
        </Link>
      </Can>
    </div>
  );

  return (
    <DataTable
      caption="Products"
      columns={COLUMNS}
      data={result.data?.data ?? []}
      getRowId={(row) => row.id}
      page={query.page}
      pageSize={pageSize}
      total={result.data?.meta?.total ?? 0}
      onPageChange={(page) => update({ page })}
      pageSizeOptions={pageSizes}
      onPageSizeChange={(size) => update({ pageSize: size })}
      sort={{ id: query.sort, desc: query.dir === "desc" }}
      onSortChange={(id, desc) => update({ sort: id as SortKey, dir: desc ? "desc" : "asc" })}
      itemNoun="products"
      isLoading={result.isPending}
      isFetching={result.isFetching}
      error={result.isError ? errorMessage(result.error) : null}
      onRetry={() => void result.refetch()}
      emptyMessage={hasFilters ? "No products match these filters." : "No products yet."}
      toolbar={toolbar}
    />
  );
}

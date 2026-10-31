"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useId, useMemo, useState, type FormEvent } from "react";
import { AdminInventoryQuery, InventoryItem } from "@hp/contracts";
import { z } from "zod";
import { Can } from "@/components/Can";
import { DataTable } from "@/components/data-table/DataTable";
import { formatCount } from "@/lib/format";
import { INVENTORY_KEY } from "@/lib/query-keys";
import { useIdempotencyKeys } from "@/lib/idempotency";
import { errorMessage, useSession } from "@/lib/session";
import { useUrlQuery } from "@/lib/url-state";
import { AdjustStockDialog } from "./AdjustStockDialog";
import { MovementDrawer } from "./MovementDrawer";

const Rows = z.array(InventoryItem);

type Open = { kind: "adjust" | "history"; item: InventoryItem } | null;

const count = (
  key: "stockOnHand" | "stockReserved" | "stockAvailable" | "lowStockThreshold",
  header: string,
): ColumnDef<InventoryItem> => ({
  accessorKey: key,
  header,
  meta: { align: "right" },
  cell: ({ row }) => formatCount(row.original[key]),
});

export function InventoryTable() {
  const { api } = useSession();
  const idempotencyKeys = useIdempotencyKeys();
  const ids = useId();
  const { query, update } = useUrlQuery(AdminInventoryQuery);
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");
  const [open, setOpen] = useState<Open>(null);

  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.q) params.set("q", query.q);
  if (query.lowStock) params.set("lowStock", "true");
  const apiQuery = params.toString();

  const result = useQuery({
    queryKey: [...INVENTORY_KEY, apiQuery],
    queryFn: () => api.get(`/admin/inventory?${apiQuery}`, Rows),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<InventoryItem>[]>(
    () => [
      {
        accessorKey: "productName",
        header: "Product",
        cell: ({ row }) => (
          <div className="min-w-44">
            <span className="text-ink-950">{row.original.productName}</span>
            <span className="block text-xs text-muted">
              {row.original.variantName}
              {!row.original.isActive && " · inactive"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "sku",
        header: "SKU",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
      },
      count("stockOnHand", "On hand"),
      count("stockReserved", "Reserved"),
      count("stockAvailable", "Available"),
      count("lowStockThreshold", "Threshold"),
      {
        id: "state",
        header: "Status",
        cell: ({ row }) =>
          row.original.lowStock ? (
            <span className="badge badge-warn">Low stock</span>
          ) : (
            <span className="badge badge-ok">OK</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Can perm="inventory:write">
              <button
                type="button"
                className="btn btn-quiet min-h-8 px-2 text-xs"
                onClick={() => setOpen({ kind: "adjust", item: row.original })}
              >
                Adjust<span className="sr-only"> {row.original.sku}</span>
              </button>
            </Can>
            <button
              type="button"
              className="btn btn-quiet min-h-8 px-2 text-xs"
              onClick={() => setOpen({ kind: "history", item: row.original })}
            >
              History<span className="sr-only"> {row.original.sku}</span>
            </button>
          </div>
        ),
      },
    ],
    [],
  );

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update({ q: searchDraft.trim() });
  };
  const hasFilters = Boolean(query.q || query.lowStock);

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <form role="search" onSubmit={handleSearch} className="flex min-w-60 flex-1 items-end gap-2">
        <div className="flex-1">
          <label htmlFor={`${ids}-q`} className="field-label">
            Search inventory
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            value={searchDraft}
            maxLength={100}
            placeholder="SKU, product or variant"
            onChange={(e) => setSearchDraft(e.target.value)}
            className="field field-compact"
          />
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
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
        <button
          type="button"
          className="btn btn-link"
          onClick={() => {
            setSearchDraft("");
            update({ q: null, lowStock: null });
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <>
      <DataTable
        caption="Inventory"
        columns={columns}
        data={result.data?.data ?? []}
        getRowId={(row) => row.variantId}
        page={query.page}
        pageSize={query.pageSize}
        total={result.data?.meta?.total ?? 0}
        onPageChange={(page) => update({ page })}
        pageSizeOptions={[24, 50, 100]}
        onPageSizeChange={(size) => update({ pageSize: size })}
        itemNoun="variants"
        isLoading={result.isPending}
        isFetching={result.isFetching}
        error={result.isError ? errorMessage(result.error) : null}
        onRetry={() => void result.refetch()}
        emptyMessage={hasFilters ? "No variants match these filters." : "No variants yet."}
        toolbar={toolbar}
      />
      {open?.kind === "adjust" && (
        <AdjustStockDialog
          item={open.item}
          idempotencyKeys={idempotencyKeys}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "history" && (
        <MovementDrawer item={open.item} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

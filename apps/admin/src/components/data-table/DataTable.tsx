"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import { useId, useState, type ReactNode } from "react";
import { formatCount } from "@/lib/format";

export type DataTableProps<T> = {
  caption: string;
  columns: ColumnDef<T>[];
  data: readonly T[];
  getRowId: (row: T) => string;
  /** Server paging: 1-based page, page size and the total across all pages. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
  /** Plural noun for the row count, e.g. "products". */
  itemNoun: string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage: string;
  emptyAction?: ReactNode;
  toolbar?: ReactNode;
  /**
   * Server-side sort. When given, only columns with `enableSorting: true` are
   * sortable and a header click calls onSortChange instead of reordering the page.
   */
  sort?: { id: string; desc: boolean };
  onSortChange?: (id: string, desc: boolean) => void;
};

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

function rowCountText(page: number, pageSize: number, total: number, noun: string): string {
  if (total === 0) return `0 ${noun}`;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `Showing ${formatCount(start)}–${formatCount(end)} of ${formatCount(total)} ${noun}`;
}

/**
 * Server-paged table on TanStack Table. Paging is owned by the caller (it maps
 * to API query params). With `sort`/`onSortChange` sorting is server-side too;
 * without them a header click reorders the rows of the current page.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const { caption, columns, data, page, pageSize, total, itemNoun, isLoading, isFetching, error } =
    props;
  const { sort, onSortChange } = props;
  const serverSort = onSortChange !== undefined;
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const sorting: SortingState = serverSort ? (sort ? [sort] : []) : localSorting;
  const pageSizeId = useId();

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    if (!serverSort) {
      setLocalSorting(next);
      return;
    }
    const [first] = next;
    if (first) onSortChange(first.id, first.desc);
    else if (sort) onSortChange(sort.id, !sort.desc);
  };

  const table = useReactTable({
    data: data as T[],
    columns,
    state: { sorting },
    onSortingChange: handleSortingChange,
    getRowId: props.getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualSorting: serverSort,
    enableSortingRemoval: !serverSort,
    sortDescFirst: false,
    ...(serverSort && { defaultColumn: { enableSorting: false } }),
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = table.getRowModel().rows;
  const colSpan = columns.length;

  return (
    <div className="panel">
      {props.toolbar && <div className="border-b border-line px-4 py-3">{props.toolbar}</div>}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800"
        >
          <span className="font-medium">{error}</span>
          {props.onRetry && (
            <button type="button" className="btn btn-quiet ml-auto" onClick={props.onRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="data-table" aria-busy={isLoading || isFetching || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const label = flexRender(header.column.columnDef.header, header.getContext());
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)
                    ?.align;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        header.column.getCanSort()
                          ? sorted
                            ? ARIA_SORT[sorted]
                            : "none"
                          : undefined
                      }
                      className={align === "right" ? "text-right" : undefined}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="sort-button"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {label}
                          <span
                            aria-hidden
                            className="sort-indicator"
                            data-sorted={sorted || undefined}
                          >
                            {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}
                          </span>
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colSpan} className="py-10 text-center">
                  <span role="status" className="text-sm text-muted">
                    Loading {itemNoun}…
                  </span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-12 text-center">
                  <p className="font-medium text-ink-950">{props.emptyMessage}</p>
                  {props.emptyAction && <div className="mt-3">{props.emptyAction}</div>}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const align = (cell.column.columnDef.meta as { align?: string } | undefined)
                      ?.align;
                    return (
                      <td
                        key={cell.id}
                        className={align === "right" ? "text-right tabular-nums" : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-2.5 text-sm">
        <p aria-live="polite" className="text-muted tabular-nums">
          {isLoading ? " " : rowCountText(page, pageSize, total, itemNoun)}
        </p>
        {props.onPageSizeChange && props.pageSizeOptions && (
          <div className="flex items-center gap-2">
            <label htmlFor={pageSizeId} className="text-muted">
              Rows per page
            </label>
            <select
              id={pageSizeId}
              className="field field-compact w-auto"
              value={pageSize}
              onChange={(e) => props.onPageSizeChange?.(Number(e.target.value))}
            >
              {props.pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted tabular-nums">
            Page {formatCount(page)} of {formatCount(totalPages)}
          </span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => props.onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
          >
            <span aria-hidden>←</span>
            <span className="sr-only">Previous page</span>
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => props.onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
          >
            <span aria-hidden>→</span>
            <span className="sr-only">Next page</span>
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useId, useMemo, useState } from "react";
import { AdminUserListItem, AuditLogEntry, AuditLogQuery, isAdminRole } from "@hp/contracts";
import { z } from "zod";
import { DataTable } from "@/components/data-table/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/format";
import { AUDIT_KEY, USERS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { useUrlQuery } from "@/lib/url-state";
import { JsonDiff } from "./JsonDiff";

const Rows = z.array(AuditLogEntry);
const People = z.array(AdminUserListItem);
const MAX_PAGE_SIZE = 100;

/** Entity names the API writes (see apps/api/src/modules/admin). */
const ENTITIES = ["Product", "Category", "Order", "ProductVariant", "Coupon", "User"] as const;

export function AuditLogViewer() {
  const { api } = useSession();
  const ids = useId();
  const { query, update } = useUrlQuery(AuditLogQuery);
  const [viewing, setViewing] = useState<AuditLogEntry | null>(null);

  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.entity) params.set("entity", query.entity);
  if (query.actorId) params.set("actorId", query.actorId);
  const apiQuery = params.toString();

  const result = useQuery({
    queryKey: [...AUDIT_KEY, apiQuery],
    queryFn: () => api.get(`/admin/audit-log?${apiQuery}`, Rows),
    placeholderData: keepPreviousData,
  });

  // Actor filter options: staff accounts (audit:read implies user:read).
  const staff = useQuery({
    queryKey: [...USERS_KEY, "audit-actors"],
    queryFn: async () =>
      (await api.get(`/admin/users?pageSize=${MAX_PAGE_SIZE}`, People)).data.filter((u) =>
        isAdminRole(u.role),
      ),
  });

  const columns = useMemo<ColumnDef<AuditLogEntry>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "actorEmail",
        header: "Who",
        cell: ({ row }) => row.original.actorEmail ?? row.original.actorId,
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
      },
      {
        id: "target",
        header: "Target",
        cell: ({ row }) => (
          <span>
            {row.original.entity}
            {row.original.entityId && (
              <span className="block font-mono text-xs text-muted">{row.original.entityId}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "ip",
        header: "IP",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.ip ?? "—"}</span>,
      },
      {
        id: "diff",
        header: () => <span className="sr-only">Changes</span>,
        cell: ({ row }) => (
          <button
            type="button"
            className="btn btn-quiet min-h-8 px-2 text-xs"
            onClick={() => setViewing(row.original)}
          >
            View changes<span className="sr-only"> for {row.original.action}</span>
          </button>
        ),
      },
    ],
    [],
  );

  const hasFilters = Boolean(query.entity || query.actorId);
  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`${ids}-entity`} className="field-label">
          Entity
        </label>
        <select
          id={`${ids}-entity`}
          value={query.entity ?? ""}
          onChange={(e) => update({ entity: e.target.value })}
          className="field field-compact w-auto"
        >
          <option value="">All entities</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${ids}-actor`} className="field-label">
          Actor
        </label>
        <select
          id={`${ids}-actor`}
          value={query.actorId ?? ""}
          onChange={(e) => update({ actorId: e.target.value })}
          className="field field-compact w-auto max-w-64"
        >
          <option value="">Anyone</option>
          {staff.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
      </div>
      {hasFilters && (
        <button
          type="button"
          className="btn btn-link"
          onClick={() => update({ entity: null, actorId: null })}
        >
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <>
      <DataTable
        caption="Audit log"
        columns={columns}
        data={result.data?.data ?? []}
        getRowId={(row) => row.id}
        page={query.page}
        pageSize={query.pageSize}
        total={result.data?.meta?.total ?? 0}
        onPageChange={(page) => update({ page })}
        itemNoun="entries"
        isLoading={result.isPending}
        isFetching={result.isFetching}
        error={result.isError ? errorMessage(result.error) : null}
        onRetry={() => void result.refetch()}
        emptyMessage={
          hasFilters ? "No entries match these filters." : "Nothing has been recorded yet."
        }
        toolbar={toolbar}
      />
      {viewing && (
        <Modal
          size="lg"
          title={`${viewing.action} · ${viewing.entity}${viewing.entityId ? ` ${viewing.entityId}` : ""}`}
          description={`${viewing.actorEmail ?? viewing.actorId}, ${formatDateTime(viewing.createdAt)}`}
          onClose={() => setViewing(null)}
        >
          <JsonDiff before={viewing.before} after={viewing.after} />
        </Modal>
      )}
    </>
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useId, useMemo, useState, type FormEvent } from "react";
import {
  AdminUserListItem,
  Page,
  PageSize,
  ROLES,
  RoleSchema,
  isAdminRole,
  type Role,
} from "@hp/contracts";
import { z } from "zod";
import { DataTable } from "@/components/data-table/DataTable";
import { formatCount, formatDate, roleLabel } from "@/lib/format";
import { USERS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { useUrlQuery } from "@/lib/url-state";
import { SendPasswordResetButton } from "./SendPasswordResetButton";
import { UserActions } from "./UserActions";

const Rows = z.array(AdminUserListItem);
const ALL = "ALL";

const UserUrlQuery = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  role: z
    .union([RoleSchema, z.literal(ALL)])
    .optional()
    .catch(undefined),
  page: Page.catch(1),
  pageSize: PageSize.catch(25),
});

type UsersTableProps = {
  /** Role shown when the URL has none: CUSTOMER on Customers, ALL on Staff. */
  defaultRole: Role | typeof ALL;
};

export function UsersTable({ defaultRole }: UsersTableProps) {
  const { api, user } = useSession();
  const ids = useId();
  const { query, update } = useUrlQuery(UserUrlQuery);
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const role = query.role ?? defaultRole;

  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.q) params.set("q", query.q);
  if (role !== ALL) params.set("role", role);
  const apiQuery = params.toString();

  const result = useQuery({
    queryKey: [...USERS_KEY, apiQuery],
    queryFn: () => api.get(`/admin/users?${apiQuery}`, Rows),
    placeholderData: keepPreviousData,
  });

  const selfId = user?.id;
  const columns = useMemo<ColumnDef<AdminUserListItem>[]>(
    () => [
      {
        id: "person",
        header: "Person",
        cell: ({ row }) => (
          <div className="min-w-48">
            <span className="text-ink-950">
              {row.original.firstName} {row.original.lastName}
              {row.original.id === selfId && <span className="ml-1 text-xs text-muted">(you)</span>}
            </span>
            <span className="user-email block text-xs text-muted">{row.original.email}</span>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <span className="badge badge-neutral">{roleLabel(row.original.role)}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.disabled ? (
              <span className="badge badge-muted">Disabled</span>
            ) : (
              <span className="badge badge-ok">Active</span>
            )}
            {isAdminRole(row.original.role) && !row.original.twoFactorEnabled && (
              <span className="badge badge-warn">2FA not set up</span>
            )}
            {!row.original.emailVerified && <span className="badge badge-neutral">Unverified</span>}
          </span>
        ),
      },
      {
        accessorKey: "orderCount",
        header: "Orders",
        meta: { align: "right" },
        cell: ({ row }) => formatCount(row.original.orderCount),
      },
      {
        accessorKey: "createdAt",
        header: "Joined",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: "lastLoginAt",
        header: "Last sign-in",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted">
            {row.original.lastLoginAt ? formatDate(row.original.lastLoginAt) : "Never"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-1">
            <SendPasswordResetButton person={row.original} onNotice={setNotice} />
            <UserActions person={row.original} onNotice={setNotice} />
          </div>
        ),
      },
    ],
    [selfId],
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
            Search people
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            value={searchDraft}
            maxLength={100}
            placeholder="Name or email"
            onChange={(e) => setSearchDraft(e.target.value)}
            className="field field-compact"
          />
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      <div>
        <label htmlFor={`${ids}-role`} className="field-label">
          Role
        </label>
        <select
          id={`${ids}-role`}
          value={role}
          onChange={(e) => update({ role: e.target.value === defaultRole ? null : e.target.value })}
          className="field field-compact w-auto"
        >
          <option value={ALL}>All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <>
      {notice && (
        <p role="status" className="notice mb-3">
          {notice}
        </p>
      )}
      <DataTable
        caption="People"
        columns={columns}
        data={result.data?.data ?? []}
        getRowId={(row) => row.id}
        page={query.page}
        pageSize={query.pageSize}
        total={result.data?.meta?.total ?? 0}
        onPageChange={(page) => update({ page })}
        itemNoun="people"
        isLoading={result.isPending}
        isFetching={result.isFetching}
        error={result.isError ? errorMessage(result.error) : null}
        onRetry={() => void result.refetch()}
        emptyMessage="Nobody matches these filters."
        toolbar={toolbar}
      />
    </>
  );
}

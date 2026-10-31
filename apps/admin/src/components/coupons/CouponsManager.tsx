"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { CouponView } from "@hp/contracts";
import { z } from "zod";
import { DataTable } from "@/components/data-table/DataTable";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import { formatCount, formatDate } from "@/lib/format";
import { COUPONS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { useMoneyFormat } from "@/lib/store-settings";
import { describeCoupon } from "./coupon-form-model";
import { CouponFormDialog } from "./CouponFormDialog";

const PAGE_SIZE = 25;
const Rows = z.array(CouponView);
const DeleteResult = z.object({ deleted: z.boolean(), deactivated: z.boolean() });

type Open = { kind: "new" } | { kind: "edit" | "remove"; coupon: CouponView } | null;

function windowText(c: CouponView): string {
  if (!c.startsAt && !c.endsAt) return "Always";
  return `${c.startsAt ? formatDate(c.startsAt) : "Now"} – ${c.endsAt ? formatDate(c.endsAt) : "no end"}`;
}

/** Coupons list with create, edit (full PATCH) and remove (deactivates used codes). */
export function CouponsManager() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const money = useMoneyFormat();

  const result = useQuery({
    queryKey: [...COUPONS_KEY, page],
    queryFn: () => api.get(`/admin/coupons?page=${page}&pageSize=${PAGE_SIZE}`, Rows),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: COUPONS_KEY });

  const columns = useMemo<ColumnDef<CouponView>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono font-medium text-ink-950">{row.original.code}</span>
        ),
      },
      {
        id: "discount",
        header: "Discount",
        cell: ({ row }) => describeCoupon(row.original, money.currency),
      },
      {
        accessorKey: "minSubtotalCents",
        header: "Minimum",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.minSubtotalCents > 0 ? money.format(row.original.minSubtotalCents) : "—",
      },
      {
        id: "window",
        header: "Valid",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted">{windowText(row.original)}</span>
        ),
      },
      {
        accessorKey: "redemptions",
        header: "Used",
        meta: { align: "right" },
        cell: ({ row }) =>
          `${formatCount(row.original.redemptions)}${row.original.maxRedemptions ? ` / ${formatCount(row.original.maxRedemptions)}` : ""}`,
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) =>
          row.original.isActive ? (
            <span className="badge badge-ok">Active</span>
          ) : (
            <span className="badge badge-muted">Inactive</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="btn btn-quiet min-h-8 px-2 text-xs"
              onClick={() => setOpen({ kind: "edit", coupon: row.original })}
            >
              Edit<span className="sr-only"> {row.original.code}</span>
            </button>
            <button
              type="button"
              className="btn btn-quiet min-h-8 px-2 text-xs"
              onClick={() => setOpen({ kind: "remove", coupon: row.original })}
            >
              Remove<span className="sr-only"> {row.original.code}</span>
            </button>
          </div>
        ),
      },
    ],
    [money],
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary ml-auto"
          onClick={() => setOpen({ kind: "new" })}
        >
          New coupon
        </button>
      </div>
      <DataTable
        caption="Coupons"
        columns={columns}
        data={result.data?.data ?? []}
        getRowId={(row) => row.id}
        page={page}
        pageSize={PAGE_SIZE}
        total={result.data?.meta?.total ?? 0}
        onPageChange={setPage}
        itemNoun="coupons"
        isLoading={result.isPending}
        isFetching={result.isFetching}
        error={result.isError ? errorMessage(result.error) : null}
        onRetry={() => void result.refetch()}
        emptyMessage="No coupons yet."
      />
      {(open?.kind === "new" || open?.kind === "edit") && (
        <CouponFormDialog
          coupon={open.kind === "edit" ? open.coupon : undefined}
          onClose={() => setOpen(null)}
          onSaved={async (saved) => {
            await refresh();
            setOpen(null);
            setNotice(`${saved.code} saved.`);
          }}
        />
      )}
      {open?.kind === "remove" && (
        <TypedConfirmDialog
          title={`Remove ${open.coupon.code}?`}
          description="An unused code is deleted. A code that customers have used is deactivated instead, so past orders still explain their discount."
          phrase={open.coupon.code}
          confirmLabel="Remove"
          onClose={() => setOpen(null)}
          onConfirm={async () => {
            const { code, id } = open.coupon;
            const { data } = await api.delete(`/admin/coupons/${id}`, DeleteResult);
            await refresh();
            setOpen(null);
            setNotice(
              data.deactivated
                ? `${code} has been used, so it was deactivated instead of deleted.`
                : `${code} was deleted.`,
            );
          }}
        />
      )}
    </>
  );
}

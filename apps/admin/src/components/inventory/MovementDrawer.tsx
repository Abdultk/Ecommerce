"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StockMovementView, type InventoryItem } from "@hp/contracts";
import { z } from "zod";
import { Modal } from "@/components/ui/Modal";
import { formatCount, formatDateTime } from "@/lib/format";
import { MOVEMENTS_KEY } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { REASON_LABELS } from "./AdjustStockDialog";

const PAGE_SIZE = 20;
const Rows = z.array(StockMovementView);

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : formatCount(n));

/** The stock ledger for one variant, newest first. */
export function MovementDrawer({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { api } = useSession();
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: [...MOVEMENTS_KEY, item.variantId, page],
    queryFn: () =>
      api.get(
        `/admin/inventory/${item.variantId}/movements?page=${page}&pageSize=${PAGE_SIZE}`,
        Rows,
      ),
    placeholderData: keepPreviousData,
  });
  const totalPages = Math.max(1, result.data?.meta?.totalPages ?? 1);

  return (
    <Modal
      variant="drawer"
      title={`Stock history · ${item.sku}`}
      description={`${item.productName}, ${item.variantName}. ${formatCount(item.stockOnHand)} on hand now.`}
      onClose={onClose}
    >
      {result.isPending ? (
        <p role="status" className="text-sm text-muted">
          Loading movements…
        </p>
      ) : result.isError ? (
        <p role="alert" className="error-text">
          {errorMessage(result.error)}
        </p>
      ) : result.data.data.length === 0 ? (
        <p className="text-sm text-muted">No stock movements yet.</p>
      ) : (
        <>
          <table className="data-table">
            <caption className="sr-only">Stock movements</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Reason</th>
                <th scope="col" className="text-right">
                  Change
                </th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {result.data.data.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(m.createdAt)}
                  </td>
                  <td>{REASON_LABELS[m.reason]}</td>
                  <td
                    className={`text-right tabular-nums ${m.delta < 0 ? "text-danger-700" : "text-ok-800"}`}
                  >
                    {signed(m.delta)}
                  </td>
                  <td className="text-xs">
                    {m.note && <span className="block">{m.note}</span>}
                    {m.orderNumber && <span className="block font-mono">{m.orderNumber}</span>}
                    {m.actorEmail && <span className="block text-muted">{m.actorEmail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <span className="text-muted tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Newer
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

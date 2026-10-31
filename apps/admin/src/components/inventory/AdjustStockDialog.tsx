"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { InventoryAdjustInput, InventoryItem, StockAdjustReason } from "@hp/contracts";
import { INVENTORY_KEY, MOVEMENTS_KEY, PRODUCTS_KEY } from "@/lib/query-keys";
import { Modal } from "@/components/ui/Modal";
import { formatCount, toInt } from "@/lib/format";
import { idempotencyHeaders, type IdempotencyKeys } from "@/lib/idempotency";
import { errorMessage, useSession } from "@/lib/session";

type Reason = (typeof StockAdjustReason.options)[number];

export const REASON_LABELS: Record<Reason | "SALE", string> = {
  RESTOCK: "Restock",
  RETURN: "Return",
  DAMAGE: "Damage",
  CORRECTION: "Correction",
  SALE: "Sale",
};

type AdjustStockDialogProps = {
  item: InventoryItem;
  /** Owned by the table so a retry after closing and reopening reuses the same key. */
  idempotencyKeys: IdempotencyKeys;
  onClose: () => void;
};

/** Every manual stock change goes through the ledger with a reason (SALE is checkout-only). */
export function AdjustStockDialog({ item, idempotencyKeys, onClose }: AdjustStockDialogProps) {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const ids = useId();
  const [change, setChange] = useState("");
  const [reason, setReason] = useState<Reason>("RESTOCK");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const delta = toInt(change);
  const preview = delta !== null && Number.isFinite(delta) ? item.stockOnHand + delta : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = InventoryAdjustInput.safeParse({
      variantId: item.variantId,
      delta: delta ?? Number.NaN,
      reason,
      ...(note.trim() && { note: note.trim() }),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.code === "invalid_type"
          ? "Enter a whole number, like 5 or -2."
          : (issue?.message ?? "Check the form."),
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const path = "/admin/inventory/adjust";
      const headers = idempotencyHeaders(idempotencyKeys, path, parsed.data);
      await api.post(path, parsed.data, InventoryItem, headers);
      idempotencyKeys.settle();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: INVENTORY_KEY }),
        queryClient.invalidateQueries({ queryKey: MOVEMENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
      ]);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Adjust stock · ${item.sku}`}
      description={`${item.productName}, ${item.variantName}: ${formatCount(item.stockOnHand)} on hand, ${formatCount(item.stockReserved)} reserved by open checkouts.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-delta`} className="field-label">
              Change
            </label>
            <input
              id={`${ids}-delta`}
              inputMode="numeric"
              value={change}
              placeholder="e.g. 12 or -2"
              aria-describedby={`${ids}-preview`}
              onChange={(e) => setChange(e.target.value)}
              className="field tabular-nums"
            />
            <p id={`${ids}-preview`} aria-live="polite" className="mt-1 text-xs text-muted">
              {preview === null
                ? "Use a minus sign to remove stock."
                : `On hand after: ${formatCount(preview)}`}
            </p>
          </div>
          <div>
            <label htmlFor={`${ids}-reason`} className="field-label">
              Reason
            </label>
            <select
              id={`${ids}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
              className="field"
            >
              {StockAdjustReason.options.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${ids}-note`} className="field-label">
            Note (optional)
          </label>
          <input
            id={`${ids}-note`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className="field"
          />
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save adjustment
          </button>
        </div>
      </form>
    </Modal>
  );
}

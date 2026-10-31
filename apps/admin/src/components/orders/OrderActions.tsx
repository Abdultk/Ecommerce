"use client";

import { useId, useState, type FormEvent } from "react";
import {
  AdminOrderDetail,
  OrderStatusUpdate,
  RefundInput,
  formatMoney,
  type ADMIN_SETTABLE_STATUSES,
} from "@hp/contracts";
import { Can } from "@/components/Can";
import { Modal } from "@/components/ui/Modal";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import { orderStatusLabel } from "@/lib/format";
import { minorToInput, moneyLabel, parseMoneyInput } from "@/lib/money";
import { idempotencyHeaders, useIdempotencyKeys } from "@/lib/idempotency";
import { errorMessage, useSession } from "@/lib/session";

type SettableStatus = (typeof ADMIN_SETTABLE_STATUSES)[number];
type ActionProps = { detail: AdminOrderDetail; onUpdated: (detail: AdminOrderDetail) => void };

const markLabel = (s: SettableStatus) => `Mark as ${orderStatusLabel(s).toLowerCase()}`;

/** One button per status the server says is allowed next (cancel and refund have their own). */
export function StatusTransitionMenu({ detail, onUpdated }: ActionProps) {
  const ids = useId();
  const [target, setTarget] = useState<SettableStatus | null>(null);
  if (detail.allowedStatuses.length === 0) return null;
  return (
    <Can perm="order:write">
      <div
        role="group"
        aria-labelledby={`${ids}-title`}
        className="flex flex-wrap items-center gap-2"
      >
        <span id={`${ids}-title`} className="sr-only">
          Change status
        </span>
        {detail.allowedStatuses.map((s) => (
          <button key={s} type="button" className="btn btn-secondary" onClick={() => setTarget(s)}>
            {markLabel(s)}
          </button>
        ))}
      </div>
      {target && (
        <StatusDialog
          detail={detail}
          status={target}
          onClose={() => setTarget(null)}
          onUpdated={(d) => {
            setTarget(null);
            onUpdated(d);
          }}
        />
      )}
    </Can>
  );
}

type StatusDialogProps = ActionProps & { status: SettableStatus; onClose: () => void };

function StatusDialog({ detail, status, onClose, onUpdated }: StatusDialogProps) {
  const { api } = useSession();
  const ids = useId();
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = OrderStatusUpdate.safeParse({
      status,
      ...(tracking.trim() && { trackingNumber: tracking }),
      ...(carrier.trim() && { carrier }),
      ...(expectedDate && { expectedDeliveryDate: expectedDate }),
      ...(note.trim() && { note }),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.patch(
        `/admin/orders/${detail.order.id}/status`,
        parsed.data,
        AdminOrderDetail,
      );
      onUpdated(data);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={markLabel(status)}
      description={`Order ${detail.order.number} is ${orderStatusLabel(detail.order.status).toLowerCase()}.${status === "SHIPPED" ? " The customer is emailed the courier, tracking number and expected date." : ""}`}
      onClose={onClose}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-3">
        {status === "SHIPPED" && (
          <>
            <div>
              <label htmlFor={`${ids}-carrier`} className="field-label">
                Courier (optional)
              </label>
              <input
                id={`${ids}-carrier`}
                value={carrier}
                maxLength={60}
                onChange={(e) => setCarrier(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-tracking`} className="field-label">
                Tracking number
              </label>
              <input
                id={`${ids}-tracking`}
                value={tracking}
                maxLength={64}
                onChange={(e) => setTracking(e.target.value)}
                className="field font-mono"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-expected`} className="field-label">
                Expected delivery date (optional)
              </label>
              <input
                id={`${ids}-expected`}
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="field"
              />
            </div>
          </>
        )}
        <div>
          <label htmlFor={`${ids}-note`} className="field-label">
            Note for the timeline (optional)
          </label>
          <textarea
            id={`${ids}-note`}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="field py-2"
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
            Update status
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Cancel (releases stock; a paid balance is refunded by the API). Shown only when canCancel. */
export function CancelOrderButton({ detail, onUpdated }: ActionProps) {
  const { api } = useSession();
  const idempotencyKeys = useIdempotencyKeys();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!detail.canCancel) return null;
  const { id, number } = detail.order;
  return (
    <Can perm="order:write">
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>
        Cancel order
      </button>
      {open && (
        <TypedConfirmDialog
          title={`Cancel ${number}?`}
          description="Reserved stock is released. If the order was paid, the remaining balance is refunded to the customer."
          phrase={number}
          confirmLabel="Cancel order"
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const body = reason.trim() ? { reason: reason.trim() } : {};
            const path = `/admin/orders/${id}/cancel`;
            const headers = idempotencyHeaders(idempotencyKeys, path, body);
            const { data } = await api.post(path, body, AdminOrderDetail, headers);
            idempotencyKeys.settle();
            setOpen(false);
            onUpdated(data);
          }}
        >
          <div>
            <label htmlFor={`${ids}-reason`} className="field-label">
              Reason (optional)
            </label>
            <textarea
              id={`${ids}-reason`}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="field py-2"
            />
          </div>
        </TypedConfirmDialog>
      )}
    </Can>
  );
}

const PROVIDER_NAMES = { amwal: "Amwal Pay", stripe: "Stripe", fake: "the test provider" } as const;

function refundDescription(detail: AdminOrderDetail, refundable: string): string {
  if (detail.order.paymentMethod === "bank_transfer") {
    return `Bank-transfer orders are refunded by hand: refund it from the store's bank account, then record the bank reference here. ${refundable} can still be refunded.`;
  }
  if (detail.order.paymentMethod === "manual") {
    return `Orders paid by ${detail.order.paymentLabel ?? "a manual method"} are refunded by hand: return the money yourself, then record your reference here. ${refundable} can still be refunded.`;
  }
  const provider = detail.paymentProvider;
  const via = provider && provider !== "manual" ? PROVIDER_NAMES[provider] : "the card provider";
  return `Refunds go back to the customer's card through ${via}. ${refundable} can still be refunded.`;
}

/** Full or partial refund; defaults to everything still refundable. */
export function RefundButton({ detail, onUpdated }: ActionProps) {
  const { api } = useSession();
  const idempotencyKeys = useIdempotencyKeys();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankReference, setBankReference] = useState("");
  const refundable = detail.refundableCents;
  if (refundable <= 0) return null;
  const { id, number, currency } = detail.order;
  const byTransfer = detail.order.paymentMethod !== "card";
  const money = (minor: number) => formatMoney(minor, currency);

  const validate = (): string | null => {
    const minor = parseMoneyInput(amount, currency);
    if (minor === null || !Number.isFinite(minor) || minor <= 0)
      return `Enter an amount like ${minorToInput(refundable, currency)}.`;
    if (minor > refundable) return `You can refund at most ${money(refundable)}.`;
    if (byTransfer && !bankReference.trim())
      return "Enter the bank reference of the refund transfer.";
    return null;
  };

  return (
    <Can perm="order:refund">
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          setAmount(minorToInput(refundable, currency));
          setReason("");
          setBankReference("");
          setOpen(true);
        }}
      >
        Refund
      </button>
      {open && (
        <TypedConfirmDialog
          title={`Refund ${number}`}
          description={refundDescription(detail, money(refundable))}
          phrase={number}
          confirmLabel="Refund"
          validate={validate}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const body = RefundInput.parse({
              amountCents: parseMoneyInput(amount, currency),
              ...(reason.trim() && { reason: reason.trim() }),
              ...(byTransfer && { bankReference: bankReference.trim() }),
            });
            const path = `/admin/orders/${id}/refund`;
            const headers = idempotencyHeaders(idempotencyKeys, path, body);
            const { data } = await api.post(path, body, AdminOrderDetail, headers);
            idempotencyKeys.settle();
            setOpen(false);
            onUpdated(data);
          }}
        >
          <div>
            <label htmlFor={`${ids}-amount`} className="field-label">
              {moneyLabel("Amount", currency)}
            </label>
            <input
              id={`${ids}-amount`}
              inputMode="decimal"
              value={amount}
              aria-describedby={`${ids}-amount-hint`}
              onChange={(e) => setAmount(e.target.value)}
              className="field tabular-nums"
            />
            <p id={`${ids}-amount-hint`} className="mt-1 text-xs text-muted">
              Up to {money(refundable)}. A refund of the full remaining amount marks the order
              refunded.
            </p>
          </div>
          {byTransfer && (
            <div>
              <label htmlFor={`${ids}-bank-ref`} className="field-label">
                Bank reference
              </label>
              <input
                id={`${ids}-bank-ref`}
                value={bankReference}
                maxLength={64}
                required
                aria-required="true"
                autoComplete="off"
                onChange={(e) => setBankReference(e.target.value)}
                className="field font-mono"
              />
            </div>
          )}
          <div>
            <label htmlFor={`${ids}-reason`} className="field-label">
              Reason (optional)
            </label>
            <textarea
              id={`${ids}-reason`}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="field py-2"
            />
          </div>
        </TypedConfirmDialog>
      )}
    </Can>
  );
}

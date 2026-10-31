"use client";

import { useId, useState } from "react";
import { ApiClientError } from "@hp/api-client";
import { ConfirmTransferInput, formatMoney, type AdminOrderDetail } from "@hp/contracts";
import { Can } from "@/components/Can";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import { useIdempotencyKeys } from "@/lib/idempotency";
import { minorToInput, moneyLabel, parseMoneyInput } from "@/lib/money";
import { useEndpoints } from "@/lib/store-settings";

type Props = { detail: AdminOrderDetail; onUpdated: (detail: AdminOrderDetail) => void };

type Fields = { amount: string; bankReference: string; note: string };

/** Turns the API's AMOUNT_MISMATCH into an instruction; other errors pass through. */
function friendlyError(err: unknown, detail: AdminOrderDetail, received: number): unknown {
  if (!(err instanceof ApiClientError) || err.code !== "AMOUNT_MISMATCH") return err;
  const { totalCents, currency } = detail.order;
  return new Error(
    `The amount received (${formatMoney(received, currency)}) doesn't match the order total (${formatMoney(totalCents, currency)}). Don't mark it paid: contact the customer about the difference.`,
  );
}

/**
 * "Confirm transfer received" for a bank-transfer order awaiting payment. The admin checks
 * the bank statement, enters the amount and bank reference, and types the order number.
 * The API marks the order paid (commits stock, emails the customer); retries reuse the key.
 */
export function ConfirmTransferButton({ detail, onUpdated }: Props) {
  const endpoints = useEndpoints();
  const keys = useIdempotencyKeys();
  const ids = useId();
  const { id, number, currency, totalCents, status, paymentMethod } = detail.order;
  const [fields, setFields] = useState<Fields | null>(null);
  if (paymentMethod === "card" || status !== "PENDING_PAYMENT") return null;
  const manual = paymentMethod === "manual";
  const what = manual ? "payment" : "transfer";

  const set = (key: keyof Fields, value: string) =>
    setFields((f) => (f ? { ...f, [key]: value } : f));

  const validate = (f: Fields): string | null => {
    const received = parseMoneyInput(f.amount, currency);
    if (received === null || !Number.isFinite(received) || received <= 0) {
      return `Enter the amount received, like ${minorToInput(totalCents, currency)}.`;
    }
    return f.bankReference.trim()
      ? null
      : manual
        ? "Enter a payment reference (a receipt or transaction number)."
        : "Enter the bank reference.";
  };

  const confirm = async (f: Fields) => {
    const body = ConfirmTransferInput.parse({
      receivedCents: parseMoneyInput(f.amount, currency),
      bankReference: f.bankReference,
      ...(f.note.trim() && { note: f.note }),
    });
    const key = keys.keyFor(`confirm-transfer ${id} ${JSON.stringify(body)}`);
    try {
      const { data } = await endpoints.adminOrders.confirmTransfer(id, body, key);
      keys.settle();
      setFields(null);
      onUpdated(data);
    } catch (err) {
      throw friendlyError(err, detail, body.receivedCents);
    }
  };

  const open = () =>
    setFields({ amount: minorToInput(totalCents, currency), bankReference: "", note: "" });

  return (
    <Can perm="order:confirm-payment">
      <button type="button" className="btn btn-primary" onClick={open}>
        Confirm {what} received
      </button>
      {fields && (
        <TypedConfirmDialog
          title={`Confirm ${what} for ${number}`}
          description={`${manual ? "Check that the money really arrived (cash collected, wallet or account balance)." : "Check the bank statement first."} The order total is ${formatMoney(totalCents, currency)}. Marking it paid commits the reserved stock and emails the customer.`}
          phrase={number}
          confirmLabel="Mark as paid"
          validate={() => validate(fields)}
          onClose={() => setFields(null)}
          onConfirm={() => confirm(fields)}
        >
          <TransferFields
            ids={ids}
            fields={fields}
            currency={currency}
            referenceLabel={manual ? "Payment reference" : "Bank reference"}
            onChange={set}
          />
        </TypedConfirmDialog>
      )}
    </Can>
  );
}

type FieldsProps = {
  ids: string;
  fields: Fields;
  currency: AdminOrderDetail["order"]["currency"];
  referenceLabel: string;
  onChange: (key: keyof Fields, value: string) => void;
};

function TransferFields({ ids, fields, currency, referenceLabel, onChange }: FieldsProps) {
  return (
    <>
      <div>
        <label htmlFor={`${ids}-amount`} className="field-label">
          {moneyLabel("Amount received", currency)}
        </label>
        <input
          id={`${ids}-amount`}
          inputMode="decimal"
          value={fields.amount}
          aria-describedby={`${ids}-amount-hint`}
          onChange={(e) => onChange("amount", e.target.value)}
          className="field tabular-nums"
        />
        <p id={`${ids}-amount-hint`} className="mt-1 text-xs text-muted">
          Exactly what you received. It must equal the order total.
        </p>
      </div>
      <div>
        <label htmlFor={`${ids}-ref`} className="field-label">
          {referenceLabel}
        </label>
        <input
          id={`${ids}-ref`}
          value={fields.bankReference}
          maxLength={64}
          required
          aria-required="true"
          autoComplete="off"
          onChange={(e) => onChange("bankReference", e.target.value)}
          className="field font-mono"
        />
      </div>
      <div>
        <label htmlFor={`${ids}-note`} className="field-label">
          Note (optional)
        </label>
        <textarea
          id={`${ids}-note`}
          rows={2}
          maxLength={500}
          value={fields.note}
          onChange={(e) => onChange("note", e.target.value)}
          className="field py-2"
        />
      </div>
    </>
  );
}

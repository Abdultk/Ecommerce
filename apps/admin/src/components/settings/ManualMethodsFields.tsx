"use client";

import { MAX_MANUAL_METHODS } from "@hp/contracts";
import type { FieldErrors, ManualForm } from "./settings-model";
import { TextField } from "./shared";

type Props = {
  idPrefix: string;
  rows: ManualForm[];
  errors: FieldErrors;
  onChange: (rows: ManualForm[]) => void;
};

const NEW_ROW: ManualForm = { id: "", label: "", instructions: "", enabled: true };
const INSTRUCTIONS_MAX = 500;

/**
 * Payment methods the shop defines itself: cash on delivery, a mobile wallet, another bank
 * account… Customers see the name and, after ordering, the instructions; staff confirm the
 * payment by hand on the order page. Errors use the "manual.<row>.<field>" keys from the model.
 */
export function ManualMethodsFields({ idPrefix, rows, errors, onChange }: Props) {
  const update = (index: number, change: Partial<ManualForm>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <p className="text-sm text-muted">
          No other payment methods yet. Add one to let customers pay another way.
        </p>
      )}
      {rows.map((row, index) => {
        const base = `${idPrefix}-${index}`;
        return (
          <div
            key={row.id || `new-${index}`}
            className="space-y-3 rounded-md border border-line p-4"
          >
            <TextField
              id={`${base}-label`}
              label="Name customers see"
              hint="For example: Cash on delivery, Mobile wallet, Pay at our shop."
              value={row.label}
              error={errors[`manual.${index}.label`]}
              onChange={(label) => update(index, { label })}
            />
            <div>
              <label htmlFor={`${base}-instructions`} className="field-label">
                Instructions for the customer
              </label>
              <textarea
                id={`${base}-instructions`}
                value={row.instructions}
                rows={3}
                maxLength={INSTRUCTIONS_MAX}
                onChange={(e) => update(index, { instructions: e.target.value })}
                aria-invalid={errors[`manual.${index}.instructions`] ? true : undefined}
                aria-describedby={`${base}-instructions-hint`}
                className="field"
              />
              <p id={`${base}-instructions-hint`} className="mt-1 text-xs text-muted">
                Shown after they place the order and in their email: where or how to pay, and any
                number or account to use.
              </p>
              {errors[`manual.${index}.instructions`] && (
                <p role="alert" className="error-text">
                  {errors[`manual.${index}.instructions`]}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="check-label">
                <input
                  type="checkbox"
                  className="check"
                  checked={row.enabled}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                />
                Show at checkout
              </label>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                Remove{row.label.trim() ? ` ${row.label.trim()}` : ""}
              </button>
            </div>
          </div>
        );
      })}
      {errors.manual && (
        <p role="alert" className="error-text">
          {errors.manual}
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={rows.length >= MAX_MANUAL_METHODS}
        onClick={() => onChange([...rows, NEW_ROW])}
      >
        Add a payment method
      </button>
    </div>
  );
}

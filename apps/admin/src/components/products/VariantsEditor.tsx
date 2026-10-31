"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FieldError } from "@/components/ui/NoAccess";
import type { CurrencyCode } from "@hp/contracts";
import { formatCount } from "@/lib/format";
import { moneyLabel } from "@/lib/money";
import {
  compareAtTooLow,
  emptyVariantRow,
  type FieldErrors,
  type VariantRow,
} from "./product-form-model";

const MAX_VARIANTS = 50;

export type VariantsUpdater = (change: (rows: VariantRow[]) => VariantRow[]) => void;

type TextField = Exclude<keyof VariantRow, "rowKey" | "id" | "isActive" | "stockOnHand">;

/** Which contract path each input's errors arrive under. */
const ERROR_PATH: Record<TextField, string> = {
  sku: "sku",
  name: "name",
  price: "priceCents",
  compareAt: "compareAtPriceCents",
  cost: "costCents",
  lowStockThreshold: "lowStockThreshold",
  weightGrams: "weightGrams",
  attributes: "attributes",
  initialStock: "initialStock",
};

type VariantsEditorProps = {
  rows: readonly VariantRow[];
  errors: FieldErrors;
  onChange: VariantsUpdater;
  currency: CurrencyCode;
  readOnly?: boolean;
};

export function VariantsEditor({
  rows,
  errors,
  onChange,
  currency,
  readOnly = false,
}: VariantsEditorProps) {
  const update = (rowKey: string, patch: Partial<VariantRow>) =>
    onChange((current) => current.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      {errors.variants && <p className="error-text">{errors.variants}</p>}
      {rows.map((row, i) => (
        <VariantFieldset
          key={row.rowKey}
          row={row}
          index={i}
          errors={errors}
          currency={currency}
          readOnly={readOnly}
          onUpdate={(patch) => update(row.rowKey, patch)}
          onRemove={() => onChange((current) => current.filter((r) => r.rowKey !== row.rowKey))}
        />
      ))}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={rows.length >= MAX_VARIANTS}
            onClick={() => onChange((current) => [...current, emptyVariantRow()])}
          >
            Add variant
          </button>
          <p className="text-xs text-muted">
            Saved variants can't be deleted (orders refer to them); turn off Active to hide one.
          </p>
        </div>
      )}
    </div>
  );
}

type VariantFieldsetProps = {
  row: VariantRow;
  index: number;
  errors: FieldErrors;
  currency: CurrencyCode;
  readOnly: boolean;
  onUpdate: (patch: Partial<VariantRow>) => void;
  onRemove: () => void;
};

function VariantFieldset({
  row,
  index,
  errors,
  currency,
  readOnly,
  onUpdate,
  onRemove,
}: VariantFieldsetProps) {
  const isNew = row.id === null;
  const legend = `Variant ${index + 1}${isNew ? " (new)" : `: ${row.name || row.sku}`}`;

  const field = (
    name: TextField,
    label: string,
    extra: { hint?: ReactNode; inputMode?: "decimal" | "numeric"; wide?: boolean } = {},
  ) => {
    const id = `${row.rowKey}-${name}`;
    const error = errors[`variants.${index}.${ERROR_PATH[name]}`];
    const describedBy = [error && `${id}-error`, extra.hint && `${id}-hint`]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={extra.wide ? "sm:col-span-2" : undefined}>
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <input
          id={id}
          value={row[name]}
          inputMode={extra.inputMode}
          disabled={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => onUpdate({ [name]: e.target.value })}
          className={`field field-compact${name === "sku" ? " font-mono" : ""}`}
        />
        {extra.hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-warn-900">
            {extra.hint}
          </p>
        )}
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  };

  return (
    <fieldset className="rounded-md border border-line bg-surface p-3">
      <legend className="px-1 text-sm font-semibold text-ink-950">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("sku", "SKU")}
        {field("name", "Name")}
        {field("price", moneyLabel("Price", currency), { inputMode: "decimal" })}
        {field("compareAt", moneyLabel("Compare-at", currency), {
          inputMode: "decimal",
          hint: compareAtTooLow(row, currency)
            ? "Compare-at price must be higher than the price."
            : undefined,
        })}
        {field("cost", moneyLabel("Cost", currency), { inputMode: "decimal" })}
        {field("lowStockThreshold", "Low-stock threshold", { inputMode: "numeric" })}
        {field("weightGrams", "Weight (g)", { inputMode: "numeric" })}
        {isNew ? (
          field("initialStock", "Initial stock", { inputMode: "numeric" })
        ) : (
          <div>
            <p className="field-label">Stock</p>
            <p className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
              <span className="tabular-nums">{formatCount(row.stockOnHand ?? 0)} on hand</span>
              <Link
                href={`/inventory?q=${encodeURIComponent(row.sku)}`}
                className="btn-link text-xs"
              >
                Adjust stock<span className="sr-only"> for {row.sku}</span>
              </Link>
            </p>
          </div>
        )}
        {field("attributes", "Attributes", { wide: true })}
        <div className="flex items-end gap-3 sm:col-span-2">
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={row.isActive}
              disabled={readOnly}
              onChange={(e) => onUpdate({ isActive: e.target.checked })}
            />
            Active
          </label>
          {isNew && !readOnly && (
            <button type="button" className="btn btn-quiet" onClick={onRemove}>
              Remove<span className="sr-only"> variant {index + 1}</span>
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Attributes: key=value pairs, e.g. size=10in, color=Black.
      </p>
    </fieldset>
  );
}

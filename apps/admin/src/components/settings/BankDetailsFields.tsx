"use client";

import type { BankForm, FieldErrors } from "./settings-model";
import { TextField } from "./shared";

type BankFieldsProps = {
  idPrefix: string;
  bank: BankForm;
  errors: FieldErrors;
  onChange: (bank: BankForm) => void;
};

/** Customer-facing bank details. Errors use the "bank.<field>" keys from the model. */
export function BankDetailsFields({ idPrefix, bank, errors, onChange }: BankFieldsProps) {
  const field = (key: keyof BankForm, label: string, hint?: string) => ({
    id: `${idPrefix}-${key}`,
    label,
    hint,
    value: bank[key],
    error: errors[`bank.${key}`],
    onChange: (value: string) => onChange({ ...bank, [key]: value }),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField {...field("bankName", "Bank name")} />
      <TextField {...field("accountName", "Account name")} />
      <TextField {...field("accountNumber", "Account number")} />
      <TextField {...field("iban", "IBAN", "Omani IBAN: OM followed by 21 characters.")} />
      <TextField {...field("swift", "SWIFT / BIC (optional)")} />
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-instructions`} className="field-label">
          Instructions shown to customers (optional)
        </label>
        <textarea
          id={`${idPrefix}-instructions`}
          value={bank.instructions}
          rows={3}
          maxLength={500}
          onChange={(e) => onChange({ ...bank, instructions: e.target.value })}
          aria-invalid={errors["bank.instructions"] ? true : undefined}
          className="field"
        />
      </div>
    </div>
  );
}

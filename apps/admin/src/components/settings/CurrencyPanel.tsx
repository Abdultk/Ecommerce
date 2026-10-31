"use client";

import { useId, useState, type FormEvent } from "react";
import { CURRENCIES, CURRENCY_CODES, CurrencyChangeInput, type CurrencyCode } from "@hp/contracts";
import { useEndpoints } from "@/lib/store-settings";
import { FieldError } from "@/components/ui/NoAccess";
import { SettingsSection, TextField, useCanWriteSettings, useSave } from "./shared";

type CurrencyForm = { currency: CurrencyCode; confirm: string; totpCode: string };

/** Zod issue paths map onto the form's own fields. */
type CurrencyErrors = Partial<Record<keyof CurrencyForm | "form", string>>;

export function CurrencyPanel({ currency }: { currency: CurrencyCode }) {
  const endpoints = useEndpoints();
  const canWrite = useCanWriteSettings();
  const save = useSave();
  const ids = useId();
  const [form, setForm] = useState<CurrencyForm>({ currency, confirm: "", totpCode: "" });
  const [errors, setErrors] = useState<CurrencyErrors>({});
  const selectId = `${ids}-currency`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = CurrencyChangeInput.safeParse(form);
    if (!parsed.success) {
      const next: CurrencyErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof CurrencyForm | undefined;
        next[key ?? "form"] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await save.run(async () => {
      await endpoints.adminSettings.changeCurrency(parsed.data);
      setForm({ currency: parsed.data.currency, confirm: "", totpCode: "" });
    }, "Currency changed.");
  };

  return (
    <SettingsSection
      title="Currency"
      description={`Every price, coupon and order is in ${currency}. You can change the store currency only before the first order. Orders keep the currency they were placed in.`}
    >
      <form onSubmit={submit} noValidate>
        <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={selectId} className="field-label">
              New store currency
            </label>
            <select
              id={selectId}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value as CurrencyCode })}
              className="field"
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} ({CURRENCIES[code].name}, {CURRENCIES[code].exponent} decimals)
                </option>
              ))}
            </select>
            <FieldError id={`${selectId}-error`} message={errors.currency} />
          </div>
          <TextField
            id={`${ids}-confirm`}
            label="Type the new currency code to confirm"
            value={form.confirm}
            error={errors.confirm}
            onChange={(confirm) => setForm({ ...form, confirm })}
          />
          <TextField
            id={`${ids}-totp`}
            label="2FA code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={form.totpCode}
            error={errors.totpCode}
            onChange={(totpCode) => setForm({ ...form, totpCode })}
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              Change currency
            </button>
            {save.notice && (
              <p role="status" className="text-sm text-ink-700">
                {save.notice}
              </p>
            )}
            {(errors.form ?? save.error) && (
              <p role="alert" className="error-text">
                {errors.form ?? save.error}
              </p>
            )}
          </div>
        </fieldset>
      </form>
    </SettingsSection>
  );
}

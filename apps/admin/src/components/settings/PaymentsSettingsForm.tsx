"use client";

import { useId, useState, type FormEvent } from "react";
import type { StoreSettings } from "@hp/contracts";
import { useEndpoints } from "@/lib/store-settings";
import {
  bankChanged,
  manualChanged,
  paymentsFormFrom,
  paymentsPatch,
  type FieldErrors,
  type PaymentsForm,
} from "./settings-model";
import { BankDetailsFields } from "./BankDetailsFields";
import { ManualMethodsFields } from "./ManualMethodsFields";
import { FormStatus, TextField, useCanWriteSettings, useSave } from "./shared";

export function PaymentsSettingsForm({ settings }: { settings: StoreSettings }) {
  const endpoints = useEndpoints();
  const canWrite = useCanWriteSettings();
  const save = useSave();
  const ids = useId();
  const [form, setForm] = useState<PaymentsForm>(() => paymentsFormFrom(settings.payments));
  const [errors, setErrors] = useState<FieldErrors>({});
  const needsCode = bankChanged(form, settings.payments) || manualChanged(form, settings.payments);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = paymentsPatch(form, settings.payments);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    await save.run(async () => {
      await endpoints.adminSettings.patchPayments(result.patch);
      setForm((current) => ({ ...current, totpCode: "" }));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={!canWrite} className="space-y-5">
        <div className="flex flex-wrap gap-6">
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={form.cardEnabled}
              onChange={(e) => setForm({ ...form, cardEnabled: e.target.checked })}
            />
            Card payments (Amwal Pay)
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={form.bankTransferEnabled}
              onChange={(e) => setForm({ ...form, bankTransferEnabled: e.target.checked })}
            />
            Bank transfer
          </label>
        </div>
        {errors.cardEnabled && (
          <p role="alert" className="error-text">
            {errors.cardEnabled}
          </p>
        )}
        <div className="max-w-xs">
          <TextField
            id={`${ids}-hold`}
            label="Hold stock for unpaid transfers and other methods (hours)"
            hint="Customers have this long to pay. You confirm each bank transfer and other manual payment by hand."
            inputMode="numeric"
            value={form.holdHours}
            error={errors.holdHours}
            onChange={(holdHours) => setForm({ ...form, holdHours })}
          />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink-950">Bank details</h3>
          {errors.bank && (
            <p role="alert" className="error-text mb-3">
              {errors.bank}
            </p>
          )}
          <BankDetailsFields
            idPrefix={`${ids}-bank`}
            bank={form.bank}
            errors={errors}
            onChange={(bank) => setForm({ ...form, bank })}
          />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Other payment methods</h3>
          <p className="mb-3 mt-1 text-sm text-muted">
            Add any other way to take payment, such as cash on delivery, a mobile wallet or another
            bank account. Customers place the order, follow your instructions, and you confirm the
            payment by hand on the order page. Switch a method off to hide it at checkout without
            deleting it.
          </p>
          <ManualMethodsFields
            idPrefix={`${ids}-manual`}
            rows={form.manualMethods}
            errors={errors}
            onChange={(manualMethods) => setForm({ ...form, manualMethods })}
          />
        </div>
        {needsCode && (
          <div className="max-w-xs">
            <TextField
              id={`${ids}-totp`}
              label="2FA code (to change bank details or payment methods)"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={form.totpCode}
              error={errors.totpCode}
              onChange={(totpCode) => setForm({ ...form, totpCode })}
            />
          </div>
        )}
        <FormStatus notice={save.notice} error={errors.form ?? save.error} />
      </fieldset>
    </form>
  );
}

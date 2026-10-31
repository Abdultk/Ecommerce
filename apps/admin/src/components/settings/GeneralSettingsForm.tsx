"use client";

import { useId, useState, type FormEvent } from "react";
import type { StoreSettings } from "@hp/contracts";
import { useEndpoints } from "@/lib/store-settings";
import { generalFormFrom, generalPatch, type FieldErrors } from "./settings-model";
import { FormStatus, TextField, useCanWriteSettings, useSave } from "./shared";

export function GeneralSettingsForm({ settings }: { settings: StoreSettings }) {
  const endpoints = useEndpoints();
  const canWrite = useCanWriteSettings();
  const save = useSave();
  const ids = useId();
  const [form, setForm] = useState(() => generalFormFrom(settings));
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = generalPatch(form, settings);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    await save.run(() => endpoints.adminSettings.patchGeneral(result.patch));
  };

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${ids}-name`}
          label="Store name"
          value={form.storeName}
          error={errors.storeName}
          onChange={(storeName) => setForm({ ...form, storeName })}
        />
        <TextField
          id={`${ids}-vat`}
          label="VAT (%)"
          value={form.vat}
          inputMode="decimal"
          hint="Applied to the subtotal after discounts. Up to 25%."
          error={errors.vat}
          onChange={(vat) => setForm({ ...form, vat })}
        />
        <FormStatus notice={save.notice} error={errors.form ?? save.error} />
      </fieldset>
    </form>
  );
}

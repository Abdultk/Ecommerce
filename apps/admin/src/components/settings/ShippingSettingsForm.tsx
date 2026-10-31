"use client";

import { useId, useState, type FormEvent } from "react";
import type { StoreSettings } from "@hp/contracts";
import { useEndpoints } from "@/lib/store-settings";
import {
  shippingFormFrom,
  shippingPatch,
  type FieldErrors,
  type ShippingForm,
} from "./settings-model";
import { FormStatus, TextField, useCanWriteSettings, useSave } from "./shared";

type MoneyField = "standard" | "express" | "freeThreshold";
type DaysField = "standardMin" | "standardMax" | "expressMin" | "expressMax";

export function ShippingSettingsForm({ settings }: { settings: StoreSettings }) {
  const endpoints = useEndpoints();
  const canWrite = useCanWriteSettings();
  const save = useSave();
  const ids = useId();
  const [form, setForm] = useState(() => shippingFormFrom(settings.shipping, settings.currency));
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (field: keyof ShippingForm) => (value: string) =>
    setForm({ ...form, [field]: value });

  const money = (field: MoneyField) => ({
    value: form[field],
    error: errors[field],
    inputMode: "decimal" as const,
    onChange: set(field),
  });
  const days = (field: DaysField) => ({
    value: form[field],
    error: errors[field],
    inputMode: "numeric" as const,
    onChange: set(field),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = shippingPatch(form, settings.currency);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    await save.run(() => endpoints.adminSettings.patchShipping(result.patch));
  };

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${ids}-standard`}
          label={`Standard rate (${settings.currency})`}
          {...money("standard")}
        />
        <TextField
          id={`${ids}-express`}
          label={`Express rate (${settings.currency})`}
          {...money("express")}
        />
        <TextField
          id={`${ids}-free`}
          label={`Free standard shipping from (${settings.currency})`}
          hint="Leave blank to turn free shipping off."
          {...money("freeThreshold")}
        />
        <TextField
          id={`${ids}-std-min`}
          label="Standard: fastest (days)"
          {...days("standardMin")}
        />
        <TextField
          id={`${ids}-std-max`}
          label="Standard: slowest (days)"
          {...days("standardMax")}
        />
        <TextField id={`${ids}-exp-min`} label="Express: fastest (days)" {...days("expressMin")} />
        <TextField id={`${ids}-exp-max`} label="Express: slowest (days)" {...days("expressMax")} />
        <div className="sm:col-span-2">
          <FormStatus notice={save.notice} error={errors.form ?? save.error} />
        </div>
      </fieldset>
    </form>
  );
}

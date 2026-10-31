"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Address } from "@hp/contracts";
import { AddressFields } from "@/components/checkout/AddressFields";
import { useSaveAddress } from "@/lib/account";
import {
  ADDRESS_FIELDS,
  addressToValues,
  parseAddress,
  type AddressErrors,
} from "@/lib/address-form";
import { readFields } from "@/lib/forms";
import { errorMessage } from "@/lib/orders";
import { useFieldFocus } from "@/lib/use-field-focus";

type Props = { address?: Address; onDone: () => void };

/** Add or edit one saved address. */
export function AddressEditor({ address, onDone }: Props) {
  const t = useTranslations("Account.addresses");
  const save = useSaveAddress();
  const [errors, setErrors] = useState<AddressErrors>({});
  const { fieldRef, focusFirst } = useFieldFocus(ADDRESS_FIELDS);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = parseAddress(readFields(form, ADDRESS_FIELDS));
    if (!result.success) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    const isDefault = new FormData(form).get("isDefault") === "on";
    save.mutate({ id: address?.id, input: { ...result.data, isDefault } }, { onSuccess: onDone });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="address-editor-heading"
      className="space-y-4 rounded-[var(--radius-pan)] bg-crust p-5 shadow-[var(--shadow-plate)]"
    >
      <h2
        id="address-editor-heading"
        ref={heading}
        tabIndex={-1}
        className="text-2xl focus:outline-none"
      >
        {address ? t("editorEdit") : t("editorNew")}
      </h2>
      {save.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <AddressFields defaults={addressToValues(address)} errors={errors} fieldRef={fieldRef} />
      {address?.isDefault ? null : (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" name="isDefault" className="size-5 accent-ember" />
          {t("useDefault")}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? t("saving") : t("save")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

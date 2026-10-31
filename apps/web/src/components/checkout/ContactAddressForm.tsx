"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { CheckoutInput, type ShippingAddress } from "@hp/contracts";
import { TextField } from "@/components/auth/TextField";
import {
  ADDRESS_FIELDS,
  parseAddress,
  type AddressErrors,
  type AddressValues,
} from "@/lib/address-form";
import { readFields } from "@/lib/forms";
import { useFieldFocus } from "@/lib/use-field-focus";
import { AddressFields } from "./AddressFields";

export type ContactDetails = { email: string; shippingAddress: ShippingAddress };

type Props = {
  defaultEmail: string;
  defaultAddress: AddressValues;
  pending: boolean;
  onSubmit: (details: ContactDetails) => void;
};

const FIELD_ORDER = ["email", ...ADDRESS_FIELDS] as const;
type Field = (typeof FIELD_ORDER)[number];

/** Step 1: email + Omani address, validated with the contract before calling the API. */
export function ContactAddressForm({ defaultEmail, defaultAddress, pending, onSubmit }: Props) {
  const t = useTranslations("Checkout");
  const [errors, setErrors] = useState<AddressErrors & { email?: string }>({});
  const { fieldRef, focusFirst } = useFieldFocus<Field>(FIELD_ORDER);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readFields(event.currentTarget, FIELD_ORDER);
    const email = CheckoutInput.shape.email.safeParse(values.email);
    const address = parseAddress(values);
    const nextErrors = {
      ...(address.success ? {} : address.errors),
      ...(email.success ? {} : { email: email.error.issues[0]?.message }),
    };
    setErrors(nextErrors);
    if (!email.success || !address.success) {
      focusFirst(nextErrors);
      return;
    }
    onSubmit({ email: email.data, shippingAddress: address.data });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <TextField
        ref={fieldRef("email")}
        name="email"
        label={t("email")}
        type="email"
        autoComplete="email"
        defaultValue={defaultEmail}
        error={errors.email}
        hint={t("emailHint")}
        required
      />
      <AddressFields defaults={defaultAddress} errors={errors} fieldRef={fieldRef} />
      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? t("gettingOptions") : t("continueToShipping")}
      </button>
    </form>
  );
}

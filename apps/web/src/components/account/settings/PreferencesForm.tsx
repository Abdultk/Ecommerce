"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  CustomerPreferencesUpdate,
  type CustomerPreferences,
  type PaymentMethod,
  type ShippingMethod,
} from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { usePreferences, useSavePreferences } from "@/lib/account-settings";
import { errorMessage } from "@/lib/orders";

const SHIPPING_METHODS: readonly ShippingMethod[] = ["standard", "express"];
const NO_DEFAULT = "";

function Switch({
  name,
  label,
  help,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  help: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[var(--color-forest)]"
        aria-describedby={`${id}-help`}
      />
      <div>
        <label htmlFor={id} className="block font-semibold">
          {label}
        </label>
        <p id={`${id}-help`} className="text-sm text-smoke">
          {help}
        </p>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  label,
  help,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  help: string;
  value: T | null;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (next: T | null) => void;
}) {
  const id = useId();
  const t = useTranslations("Account.prefs");
  return (
    <div className="space-y-1.5 py-3">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      <select
        id={id}
        className="field max-w-xs"
        value={value ?? NO_DEFAULT}
        onChange={(e) => onChange(e.target.value === NO_DEFAULT ? null : (e.target.value as T))}
        aria-describedby={`${id}-help`}
      >
        <option value={NO_DEFAULT}>{t("askEach")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
      <p id={`${id}-help`} className="text-sm text-smoke">
        {help}
      </p>
    </div>
  );
}

function PreferencesFields({ saved }: { saved: CustomerPreferences }) {
  const t = useTranslations("Account.prefs");
  const { paymentMethods } = useStoreConfig();
  const save = useSavePreferences();
  // A saved default can only be a built-in method: admin-defined ones are picked at checkout.
  const paymentLabels: Record<Exclude<PaymentMethod, "manual">, string> = {
    card: t("card"),
    bank_transfer: t("bank_transfer"),
  };
  const defaultablePayments = paymentMethods.filter(
    (m): m is Exclude<PaymentMethod, "manual"> => m !== "manual",
  );
  const shippingLabels: Record<ShippingMethod, string> = {
    standard: t("standard"),
    express: t("express"),
  };
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [marketing, setMarketing] = useState(saved.marketingEmails);
  const [shippingEmails, setShippingEmails] = useState(saved.shippingUpdateEmails);
  const [payment, setPayment] = useState<Exclude<PaymentMethod, "manual"> | null>(
    saved.preferredPayment === "manual" ? null : saved.preferredPayment,
  );
  const [shipping, setShipping] = useState(saved.preferredShipping);
  const [phoneError, setPhoneError] = useState<string>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CustomerPreferencesUpdate.safeParse({
      phone: phone.trim() === "" ? null : phone,
      marketingEmails: marketing,
      shippingUpdateEmails: shippingEmails,
      preferredPayment: payment,
      preferredShipping: shipping,
    });
    if (!parsed.success) {
      setPhoneError(parsed.error.flatten().fieldErrors.phone?.[0]);
      document.getElementById("pref-phone")?.focus();
      return;
    }
    setPhoneError(undefined);
    // The server stores the number in its +968 form; show it back that way.
    save.mutate(parsed.data, { onSuccess: (stored) => setPhone(stored.phone ?? "") });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-xl space-y-8">
      <section aria-labelledby="pref-contact" className="space-y-2">
        <h2 id="pref-contact" className="text-xl">
          {t("contact")}
        </h2>
        <div className="space-y-1.5">
          <label htmlFor="pref-phone" className="block text-sm font-semibold">
            {t("mobile")}
          </label>
          <input
            id="pref-phone"
            className="field max-w-xs"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneError ? true : undefined}
            aria-describedby="pref-phone-help"
          />
          <p
            id="pref-phone-help"
            className={phoneError ? "text-sm font-medium text-danger" : "text-sm text-smoke"}
          >
            {phoneError ?? t("phoneHelp")}
          </p>
        </div>
      </section>

      <section aria-labelledby="pref-checkout" className="divide-y divide-line">
        <h2 id="pref-checkout" className="pb-2 text-xl">
          {t("checkoutDefaults")}
        </h2>
        {defaultablePayments.length > 1 ? (
          <Choice
            label={t("preferredPayment")}
            help={t("paymentHelp")}
            value={payment}
            options={defaultablePayments}
            labels={paymentLabels}
            onChange={setPayment}
          />
        ) : null}
        <Choice
          label={t("preferredDelivery")}
          help={t("deliveryHelp")}
          value={shipping}
          options={SHIPPING_METHODS}
          labels={shippingLabels}
          onChange={setShipping}
        />
      </section>

      <section aria-labelledby="pref-email" className="divide-y divide-line">
        <h2 id="pref-email" className="pb-2 text-xl">
          {t("email")}
        </h2>
        <Switch
          name="shippingUpdateEmails"
          label={t("shipUpdates")}
          help={t("shipUpdatesHelp")}
          checked={shippingEmails}
          onChange={setShippingEmails}
        />
        <Switch
          name="marketingEmails"
          label={t("marketing")}
          help={t("marketingHelp")}
          checked={marketing}
          onChange={setMarketing}
        />
      </section>

      {save.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <p role="status" className={save.isSuccess ? "text-sm font-semibold text-sage" : "sr-only"}>
        {save.isSuccess ? t("saved") : ""}
      </p>
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>
        {save.isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}

export function PreferencesForm() {
  const t = useTranslations("Account.prefs");
  const prefs = usePreferences();
  if (prefs.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <div className="skeleton h-64 max-w-xl" />
      </div>
    );
  }
  if (prefs.isError) {
    return (
      <p role="alert" className="font-semibold text-danger">
        {errorMessage(prefs.error)}
      </p>
    );
  }
  return <PreferencesFields saved={prefs.data} />;
}

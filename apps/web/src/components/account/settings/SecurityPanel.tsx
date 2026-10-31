"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CustomerChangePasswordInput } from "@hp/contracts";
import { TextField } from "@/components/auth/TextField";
import {
  useChangePassword,
  useSessions,
  useSignOutDevice,
  useSignOutOtherDevices,
} from "@/lib/account-settings";
import { intlLocale, type Locale } from "@/i18n/config";
import { formatDateTimeIn } from "@/lib/format";
import { readFields, validateForm, type FieldErrors } from "@/lib/forms";
import { errorMessage } from "@/lib/orders";
import { useFieldFocus } from "@/lib/use-field-focus";

const FIELDS = ["currentPassword", "newPassword"] as const;
type Field = (typeof FIELDS)[number];

function PasswordForm() {
  const t = useTranslations("Account.security");
  const change = useChangePassword();
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const { fieldRef, focusFirst } = useFieldFocus(FIELDS);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = validateForm(CustomerChangePasswordInput, readFields(form, FIELDS));
    if (!result.success) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    change.mutate(result.data, { onSuccess: () => form.reset() });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-md space-y-5">
      <TextField
        ref={fieldRef("currentPassword")}
        name="currentPassword"
        type="password"
        label={t("current")}
        autoComplete="current-password"
        error={errors.currentPassword}
        required
      />
      <TextField
        ref={fieldRef("newPassword")}
        name="newPassword"
        type="password"
        label={t("new")}
        autoComplete="new-password"
        error={errors.newPassword}
        hint={t("newHint")}
        required
      />
      {change.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(change.error)}
        </p>
      ) : null}
      <p role="status" className={change.isSuccess ? "text-sm font-semibold text-sage" : "sr-only"}>
        {change.isSuccess ? t("changed") : ""}
      </p>
      <button type="submit" className="btn btn-primary" disabled={change.isPending}>
        {change.isPending ? t("changing") : t("change")}
      </button>
    </form>
  );
}

function Devices() {
  const t = useTranslations("Account.security");
  const account = useTranslations("Account");
  const locale = useLocale() as Locale;
  const sessions = useSessions();
  const signOut = useSignOutDevice();
  const signOutOthers = useSignOutOtherDevices();

  if (sessions.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{t("devicesLoading")}</span>
        <div className="skeleton h-24 max-w-xl" />
      </div>
    );
  }
  if (sessions.isError) {
    return (
      <p role="alert" className="font-semibold text-danger">
        {errorMessage(sessions.error)}
      </p>
    );
  }
  const others = sessions.data.filter((s) => !s.current);

  return (
    <div className="max-w-xl space-y-4">
      <ul className="divide-y divide-line">
        {sessions.data.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="font-semibold">
                {s.device}
                {s.current ? (
                  <span className="ms-2 text-sm text-sage">{t("thisDevice")}</span>
                ) : null}
              </p>
              <p className="text-sm text-smoke">
                {t("signedIn", { when: formatDateTimeIn(s.signedInAt, intlLocale(locale)) })}
              </p>
            </div>
            {s.current ? null : (
              <button
                type="button"
                className="btn"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate(s.id)}
                aria-label={t("signOutDevice", { device: s.device })}
              >
                {account("signOut")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {signOut.isError || signOutOthers.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(signOut.error ?? signOutOthers.error)}
        </p>
      ) : null}
      {others.length > 0 ? (
        <button
          type="button"
          className="btn"
          disabled={signOutOthers.isPending}
          onClick={() => signOutOthers.mutate()}
        >
          {t("signOutOthers")}
        </button>
      ) : (
        <p className="text-sm text-smoke">{t("onlyThis")}</p>
      )}
    </div>
  );
}

export function SecurityPanel() {
  const t = useTranslations("Account.security");
  return (
    <div className="space-y-10">
      <section aria-labelledby="sec-password" className="space-y-4">
        <h2 id="sec-password" className="text-xl">
          {t("password")}
        </h2>
        <PasswordForm />
      </section>
      <section aria-labelledby="sec-devices" className="space-y-4">
        <h2 id="sec-devices" className="text-xl">
          {t("devices")}
        </h2>
        <Devices />
      </section>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ProfileUpdate } from "@hp/contracts";
import { TextField } from "@/components/auth/TextField";
import { useUpdateProfile } from "@/lib/account";
import { readFields, validateForm, type FieldErrors } from "@/lib/forms";
import { errorMessage } from "@/lib/orders";
import { useAuth } from "@/lib/use-auth";
import { useFieldFocus } from "@/lib/use-field-focus";

const FIELDS = ["firstName", "lastName"] as const;
type Field = (typeof FIELDS)[number];

/** Name only: email changes need re-verification and are not offered by the API. */
export function ProfileForm() {
  const t = useTranslations("Account.profile");
  const { user } = useAuth();
  const update = useUpdateProfile();
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const { fieldRef, focusFirst } = useFieldFocus(FIELDS);

  if (!user) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateForm(ProfileUpdate, readFields(event.currentTarget, FIELDS));
    if (!result.success) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    update.mutate(result.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-md space-y-5">
      <TextField
        ref={fieldRef("firstName")}
        name="firstName"
        label={t("firstName")}
        autoComplete="given-name"
        defaultValue={user.firstName}
        error={errors.firstName}
        required
      />
      <TextField
        ref={fieldRef("lastName")}
        name="lastName"
        label={t("lastName")}
        autoComplete="family-name"
        defaultValue={user.lastName}
        error={errors.lastName}
        required
      />
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">{t("email")}</p>
        <p className="text-smoke">
          <bdi>{user.email}</bdi> {user.emailVerified ? t("verified") : t("unverified")}
        </p>
      </div>
      {update.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(update.error)}
        </p>
      ) : null}
      <p role="status" className={update.isSuccess ? "text-sm font-semibold text-sage" : "sr-only"}>
        {update.isSuccess ? t("saved") : ""}
      </p>
      <button type="submit" className="btn btn-primary" disabled={update.isPending}>
        {update.isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}

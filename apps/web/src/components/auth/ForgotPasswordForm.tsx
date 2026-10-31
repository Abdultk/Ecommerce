"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ForgotPasswordInput } from "@hp/contracts";
import { browserApi } from "@/lib/api";
import { readFields, validateForm, type FieldErrors } from "@/lib/forms";
import { errorMessage } from "@/lib/orders";
import { TextField } from "./TextField";

/** Always the same answer, so the form can't be used to discover accounts. */
export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const [errors, setErrors] = useState<FieldErrors<"email">>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const email = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateForm(ForgotPasswordInput, readFields(event.currentTarget, ["email"]));
    if (!result.success) {
      setErrors(result.errors);
      email.current?.focus();
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await browserApi.post("/auth/forgot-password", result.data);
      setSent(true);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="rounded-[var(--radius-tile)] bg-sage-wash p-4">
        {t("forgot.sent")}
      </p>
    );
  }

  return (
    <form method="post" onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
      {formError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {formError}
        </p>
      ) : null}
      <TextField
        ref={email}
        name="email"
        label={t("email")}
        type="email"
        autoComplete="email"
        error={errors.email}
        required
      />
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? t("forgot.sending") : t("forgot.send")}
      </button>
    </form>
  );
}

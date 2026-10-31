"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PASSWORD_MIN_LENGTH, ResetPasswordInput } from "@hp/contracts";
import { browserApi } from "@/lib/api";
import { readFields, type FieldErrors } from "@/lib/forms";
import { errorMessage } from "@/lib/orders";
import { useUrlSecret } from "@/lib/url-secrets";
import { TextField } from "./TextField";

type Field = "password" | "confirm";

/** The token is read once and stripped from the URL before the form even renders. */
export function ResetPasswordForm() {
  const t = useTranslations("Auth.reset");
  const signIn = useTranslations("Auth");
  const reg = signIn;
  const token = useUrlSecret("hash-or-query");
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readFields(event.currentTarget, ["password", "confirm"] as const);
    const parsed = ResetPasswordInput.safeParse({ token, password: values.password });
    const nextErrors: FieldErrors<Field> = {
      password: parsed.success ? undefined : parsed.error.flatten().fieldErrors.password?.[0],
      confirm: values.password === values.confirm ? undefined : t("mismatch"),
    };
    if (!parsed.success || nextErrors.password || nextErrors.confirm) {
      setErrors(nextErrors);
      (nextErrors.password ? password : confirm).current?.focus();
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await browserApi.post("/auth/reset-password", parsed.data);
      setDone(true);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (token === undefined) return <div aria-busy="true" className="skeleton h-40" />;
  if (token === null) {
    return (
      <div className="space-y-4">
        <p>{t("incomplete")}</p>
        <Link href="/forgot-password" className="btn btn-primary">
          {t("requestNew")}
        </Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-[var(--radius-tile)] bg-sage-wash p-4">
          {t("done")}
        </p>
        <Link href="/login" className="btn btn-primary">
          {signIn("signIn")}
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
      {formError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {formError}{" "}
          <Link href="/forgot-password" className="link-underline">
            {t("requestNew")}
          </Link>
        </p>
      ) : null}
      <TextField
        ref={password}
        name="password"
        label={t("newPassword")}
        type="password"
        autoComplete="new-password"
        hint={reg("register.passwordHint", { min: PASSWORD_MIN_LENGTH })}
        error={errors.password}
        required
      />
      <TextField
        ref={confirm}
        name="confirm"
        label={t("confirm")}
        type="password"
        autoComplete="new-password"
        error={errors.confirm}
        required
      />
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? t("saving") : t("submit")}
      </button>
    </form>
  );
}

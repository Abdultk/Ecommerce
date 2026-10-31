"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PASSWORD_MIN_LENGTH, RegisterInput } from "@hp/contracts";
import { browserApi } from "@/lib/api";
import { errorMessage } from "@/lib/orders";
import { AuthForm, type AuthFieldSpec } from "./AuthForm";

type Field = "firstName" | "lastName" | "email" | "password";

/** Registering never signs anyone in: the same "check your email" answer follows every sign-up. */
function CheckYourEmail({ email }: { email: string }) {
  const t = useTranslations("Auth");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setStatus("sending");
    setError(null);
    try {
      await browserApi.post("/auth/resend-verification", { email });
      setStatus("sent");
    } catch (err) {
      setError(errorMessage(err));
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-4">
      <p role="status" className="rounded-[var(--radius-tile)] bg-sage-wash p-4">
        {t("register.checkEmail", { email })}
      </p>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={status !== "idle"}
          onClick={() => void resend()}
        >
          {status === "sending" ? t("register.resending") : t("register.resend")}
        </button>
        {status === "sent" ? <span role="status">{t("register.resent")}</span> : null}
        <Link href="/login" className="link-underline font-semibold text-iron">
          {t("signIn")}
        </Link>
      </div>
    </div>
  );
}

export function RegisterForm({ redirectTo = "/" }: { redirectTo?: string }) {
  const t = useTranslations("Auth");
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (sentTo) return <CheckYourEmail email={sentTo} />;

  const fields: readonly AuthFieldSpec<Field>[] = [
    { name: "firstName", label: t("register.firstName"), type: "text", autoComplete: "given-name" },
    { name: "lastName", label: t("register.lastName"), type: "text", autoComplete: "family-name" },
    { name: "email", label: t("email"), type: "email", autoComplete: "email" },
    {
      name: "password",
      label: t("password"),
      type: "password",
      autoComplete: "new-password",
      hint: t("register.passwordHint", { min: PASSWORD_MIN_LENGTH }),
    },
  ];
  return (
    <AuthForm
      schema={RegisterInput}
      fields={fields}
      endpoint="/auth/register"
      submitLabel={t("register.submit")}
      pendingLabel={t("register.pending")}
      redirectTo={redirectTo}
      onRegistered={(values) => setSentTo(values.email)}
      footer={
        <p className="text-center text-sm text-smoke">
          {t("register.already")}{" "}
          <Link href="/login" className="link-underline font-semibold text-iron">
            {t("signIn")}
          </Link>
        </p>
      }
    />
  );
}

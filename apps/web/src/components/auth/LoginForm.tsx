"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LoginInput } from "@hp/contracts";
import { AuthForm, type AuthFieldSpec } from "./AuthForm";

type Field = "email" | "password";

export function LoginForm({ redirectTo = "/" }: { redirectTo?: string }) {
  const t = useTranslations("Auth");
  const fields: readonly AuthFieldSpec<Field>[] = [
    { name: "email", label: t("email"), type: "email", autoComplete: "email" },
    { name: "password", label: t("password"), type: "password", autoComplete: "current-password" },
  ];
  return (
    <AuthForm
      schema={LoginInput}
      fields={fields}
      endpoint="/auth/login"
      submitLabel={t("signIn")}
      pendingLabel={t("signingIn")}
      redirectTo={redirectTo}
      footer={
        <>
          <p className="text-center text-sm">
            <Link href="/forgot-password" className="link-underline font-semibold text-iron">
              {t("login.forgot")}
            </Link>
          </p>
          <p className="text-center text-sm text-smoke">
            {t("login.newHere")}{" "}
            <Link href="/register" className="link-underline font-semibold text-iron">
              {t("login.create")}
            </Link>
          </p>
        </>
      }
    />
  );
}

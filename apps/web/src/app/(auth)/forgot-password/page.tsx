import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.forgot");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("Auth.forgot");
  return (
    <>
      <p className="stamp">{t("kicker")}</p>
      <h1 className="mb-3 mt-2 text-4xl">{t("title")}</h1>
      <p className="mb-8 text-smoke">{t("lead")}</p>
      <ForgotPasswordForm />
    </>
  );
}

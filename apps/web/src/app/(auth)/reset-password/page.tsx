import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.reset");
  return { title: t("metaTitle"), robots: { index: false }, referrer: "no-referrer" };
}

export default async function ResetPasswordPage() {
  const t = await getTranslations("Auth.reset");
  return (
    <>
      <p className="stamp">{t("kicker")}</p>
      <h1 className="mb-8 mt-2 text-4xl">{t("metaTitle")}</h1>
      <ResetPasswordForm />
    </>
  );
}

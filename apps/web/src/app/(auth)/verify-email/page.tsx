import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VerifyEmail } from "@/components/auth/VerifyEmail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.verify");
  return { title: t("metaTitle"), robots: { index: false }, referrer: "no-referrer" };
}

export default async function VerifyEmailPage() {
  const t = await getTranslations("Auth.verify");
  return (
    <>
      <p className="stamp">{t("kicker")}</p>
      <h1 className="mb-8 mt-2 text-4xl">{t("metaTitle")}</h1>
      <VerifyEmail />
    </>
  );
}

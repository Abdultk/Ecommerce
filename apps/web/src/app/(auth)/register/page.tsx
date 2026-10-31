import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/RegisterForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.register");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function RegisterPage() {
  const t = await getTranslations("Auth.register");
  return (
    <>
      <h1 className="text-4xl">{t("metaTitle")}</h1>
      <p className="mb-8 mt-3 text-lg text-smoke">{t("kicker")}</p>
      <RegisterForm />
    </>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeRedirect } from "@/lib/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth");
  return { title: t("login.metaTitle"), robots: { index: false } };
}

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const t = await getTranslations("Auth");
  const { next } = await searchParams;
  const redirectTo = safeRedirect(typeof next === "string" ? next : undefined);
  return (
    <>
      <h1 className="text-4xl">{t("signIn")}</h1>
      <p className="mb-8 mt-3 text-lg text-smoke">{t("login.kicker")}</p>
      <LoginForm redirectTo={redirectTo} />
    </>
  );
}

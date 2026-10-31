import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Checkout");
  return { title: t("title"), robots: { index: false } };
}

export default async function CheckoutPage() {
  const t = await getTranslations("Checkout");
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-10">
      <p className="stamp">{t("kicker")}</p>
      <h1 className="mb-8 mt-2 text-[length:var(--text-display)]">{t("title")}</h1>
      <CheckoutFlow />
    </div>
  );
}

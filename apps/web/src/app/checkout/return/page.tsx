import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckoutReturn } from "@/components/checkout/CheckoutReturn";

// A hand-edited return link could carry a token; never leak it in a Referer.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Checkout.return");
  return { title: t("statusTitle"), robots: { index: false }, referrer: "no-referrer" };
}

export default function CheckoutReturnPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-10">
      <CheckoutReturn />
    </div>
  );
}

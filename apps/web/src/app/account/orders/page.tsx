import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OrderHistory } from "@/components/account/OrderHistory";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.nav"))("orders") };
}

export default async function OrdersPage() {
  const t = await getTranslations("Account");
  return (
    <>
      <h1 className="mb-6 text-[length:var(--text-display)]">{t("ordersHeading")}</h1>
      <OrderHistory />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OrderNumber } from "@hp/contracts";
import { OrderDetailView } from "@/components/account/OrderDetailView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account"))("orderDetails") };
}

type Props = { params: Promise<{ number: string }> };

export default async function AccountOrderPage({ params }: Props) {
  const { number } = await params;
  if (!OrderNumber.safeParse(number).success) notFound();
  const t = await getTranslations("Account");
  return (
    <>
      <Link href="/account/orders" className="link-underline mb-4 inline-block text-sm">
        {t("allOrders")}
      </Link>
      <OrderDetailView number={number} />
    </>
  );
}

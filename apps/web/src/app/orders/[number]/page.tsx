import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OrderNumber } from "@hp/contracts";
import { GuestOrderView } from "@/components/orders/GuestOrderView";

// Order emails link here with #token=…; the fragment never reaches a server.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("yourOrder"), robots: { index: false }, referrer: "no-referrer" };
}

type Props = { params: Promise<{ number: string }> };

export default async function OrderPage({ params }: Props) {
  const { number } = await params;
  if (!OrderNumber.safeParse(number).success) notFound();
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-10">
      <GuestOrderView number={number} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { OrderNumber } from "@hp/contracts";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The old Stripe return URL (/checkout/complete?order=…) from payments started before the
 * switch. Forwards the order number only (never a token) to /checkout/return.
 */
export default async function CheckoutCompletePage({ searchParams }: Props) {
  const order = (await searchParams).order;
  const number = OrderNumber.safeParse(order);
  redirect(
    number.success
      ? `/checkout/return?${new URLSearchParams({ number: number.data }).toString()}`
      : "/checkout/return",
  );
}

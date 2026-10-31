"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { errorMessage, lookupGuestOrder } from "@/lib/orders";
import { useUrlSecret } from "@/lib/url-secrets";
import { useAuth } from "@/lib/use-auth";
import { OrderDetailBody } from "./OrderDetailBody";

/**
 * Landing page for order emails: `/orders/<number>#token=<lookupToken>`. A fragment is
 * never sent to any server; the token is read once, stripped from the URL and POSTed to
 * /orders/lookup in the request body.
 */
export function GuestOrderView({ number }: { number: string }) {
  const t = useTranslations("Account.orders");
  const { user, ready } = useAuth();
  const token = useUrlSecret("hash");

  const order = useQuery({
    queryKey: ["guest-order", number],
    enabled: Boolean(token),
    queryFn: () => lookupGuestOrder(number, token ?? ""),
    retry: false,
    // Order PII is only for whoever holds the token: never kept for a later visit.
    gcTime: 0,
  });

  if (token === undefined || (token && order.isPending)) {
    return <div aria-busy="true" className="skeleton h-96" />;
  }
  if (token && order.isError) {
    return (
      <p role="alert" className="font-semibold text-danger">
        {errorMessage(order.error)} {t("linkProblem")}
      </p>
    );
  }
  if (token && order.data) return <OrderDetailBody order={order.data} />;
  if (!ready) return <div aria-busy="true" className="skeleton h-48" />;
  if (user) {
    return (
      <p>
        <Link href={`/account/orders/${number}`} className="btn btn-primary">
          {t("viewInAccount")}
        </Link>
      </p>
    );
  }
  return (
    <p className="text-smoke">
      {t.rich("toSee", {
        signin: (chunks) => (
          <Link
            href={`/login?next=${encodeURIComponent(`/account/orders/${number}`)}`}
            className="link-underline"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}

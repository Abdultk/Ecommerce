"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { formatMoney } from "@hp/contracts";
import { intlLocale, type Locale } from "@/i18n/config";
import { formatDateIn } from "@/lib/format";
import { errorMessage, useOrders } from "@/lib/orders";

/** Paged order history: paid orders and bank transfers still awaiting payment. */
export function OrderHistory() {
  const t = useTranslations("Account.orders");
  const locale = useLocale() as Locale;
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error } = useOrders(page);

  if (isPending) return <div aria-busy="true" className="skeleton h-48" />;
  if (isError) {
    return (
      <p role="alert" className="font-semibold text-danger">
        {errorMessage(error)}
      </p>
    );
  }
  const orders = data.data;
  const totalPages = data.meta?.totalPages ?? 1;
  if (orders.length === 0) {
    return (
      <div className="tile-bg rounded-[var(--radius-pan)] p-10 text-center">
        <p className="font-display text-2xl">{t("none")}</p>
        <Link href="/shop" className="btn btn-primary mt-4">
          {t("start")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/account/orders/${order.number}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-tile)] bg-crust p-4 shadow-[var(--shadow-plate)] hover:shadow-[var(--shadow-lift)]"
            >
              <span>
                <span className="block font-mono font-semibold">{order.number}</span>
                <span className="text-sm text-smoke">
                  {formatDateIn(order.createdAt, intlLocale(locale))} ·{" "}
                  {t("items", { count: order.itemCount, n: order.itemCount })}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <StatusBadge status={order.status} paymentMethod={order.paymentMethod} />
                <span className="font-semibold">
                  {formatMoney(order.totalCents, order.currency)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label={t("pages")} className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("prevPage")}
          </button>
          <p aria-live="polite" className="text-sm text-smoke">
            {t("page", { page, total: totalPages })}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("nextPage")}
          </button>
        </nav>
      ) : null}
    </div>
  );
}

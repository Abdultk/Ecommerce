"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cartErrorMessage, useCart, useRemoveCartItem, useUpdateCartItem } from "@/lib/cart";
import { takeCartNotice } from "@/lib/handoff";
import { CartLineItem } from "./CartLineItem";
import { CouponForm } from "./CouponForm";
import { FreeShippingMeter } from "./FreeShippingMeter";
import { GiftWrapOption } from "./GiftWrapOption";
import { OrderSummary } from "./OrderSummary";

type Props = { variant: "drawer" | "page"; onNavigate?: () => void };

/** Shared body of the cart drawer and the /cart page: loading, error, empty and filled states. */
export function CartContents({ variant, onNavigate }: Props) {
  const t = useTranslations("Cart");
  const { data: cart, isPending, isError, error, refetch } = useCart();
  // Mutations live here, not in the line: a removed line that rolls back remounts.
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const [lineErrors, setLineErrors] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const handedOver = takeCartNotice();
    if (handedOver) setNotice(handedOver);
  }, []);

  const setLineError = (lineId: string, message: string | null) =>
    setLineErrors(({ [lineId]: _old, ...rest }) =>
      message ? { ...rest, [lineId]: message } : rest,
    );

  const changeQuantity = (lineId: string, quantity: number) => {
    setLineError(lineId, null);
    update.mutate(
      { lineId, quantity },
      { onError: (err) => setLineError(lineId, cartErrorMessage(err)) },
    );
  };

  const removeLine = (lineId: string) => {
    setLineError(lineId, null);
    remove.mutate(lineId, { onError: (err) => setLineError(lineId, cartErrorMessage(err)) });
  };

  const noticeBanner = notice ? (
    <p
      role="alert"
      className="mb-4 rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
    >
      {notice}
    </p>
  ) : null;

  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4 py-4">
        <span className="sr-only">{t("loading")}</span>
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-[var(--radius-tile)] bg-danger-wash p-4 text-sm"
      >
        <p className="font-semibold text-danger">{cartErrorMessage(error)}</p>
        <button type="button" className="btn btn-ghost" onClick={() => void refetch()}>
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <>
        {noticeBanner}
        <div className="tile-bg grid place-items-center gap-4 rounded-[var(--radius-pan)] px-6 py-12 text-center">
          <p className="font-display text-2xl">{t("emptyTitle")}</p>
          <p className="max-w-xs text-sm text-smoke">{t("emptyBody")}</p>
          <Link href="/shop" onClick={onNavigate} className="btn btn-primary">
            {t("browse")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className={variant === "page" ? "grid gap-10 lg:grid-cols-[1fr_360px]" : "flex flex-col"}>
      <div>
        {noticeBanner}
        {/* Dynamic Free Shipping Threshold Meter */}
        <FreeShippingMeter subtotalCents={cart.totals.subtotalCents} />

        <ul aria-label={t("itemsLabel")} className="divide-y divide-line">
          {cart.items.map((line) => (
            <CartLineItem
              currency={cart.currency}
              key={line.id}
              line={line}
              onNavigate={onNavigate}
              onQuantity={(quantity) => changeQuantity(line.id, quantity)}
              onRemove={() => removeLine(line.id)}
              error={lineErrors[line.id]}
              busy={update.isPending && update.variables?.lineId === line.id}
            />
          ))}
        </ul>
      </div>

      <section
        aria-label={t("summaryLabel")}
        className={
          variant === "page"
            ? "h-fit rounded-[var(--radius-pan)] bg-crust p-6 shadow-[var(--shadow-plate)]"
            : "border-t border-line pt-4"
        }
      >
        {/* Heirloom Gift Packaging & Message Option */}
        <GiftWrapOption />

        <OrderSummary totals={cart.totals} currency={cart.currency} couponCode={cart.couponCode} />
        <CouponForm couponCode={cart.couponCode} />

        <div className="mt-5 grid gap-2">
          {variant === "drawer" ? (
            <Link href="/cart" onClick={onNavigate} className="btn btn-ghost">
              {t("viewCart")}
            </Link>
          ) : null}
          <Link href="/checkout" onClick={onNavigate} className="btn btn-primary">
            {t("checkout")}
          </Link>
        </div>

        {/* Guaranteed Safe Checkout Methods */}
        <div className="mt-3 text-center">
          <p className="text-[11px] text-smoke">
            {t("expressCheckout.methods")}
          </p>
        </div>
      </section>
    </div>
  );
}

import { useTranslations } from "next-intl";
import { formatMoney, type CurrencyCode, type Totals } from "@hp/contracts";

type Props = {
  totals: Totals;
  /** The cart's or order's own currency. */
  currency: CurrencyCode;
  couponCode?: string | null;
  /** Final (order or checkout-intent) totals show zero tax instead of "calculated later". */
  final?: boolean;
};

/** Totals are always the server's numbers; the client only displays them. */
export function OrderSummary({ totals, currency, couponCode = null, final = false }: Props) {
  const t = useTranslations("Cart.summary");
  const { subtotalCents, discountCents, shippingCents, taxCents, totalCents } = totals;
  const money = (minor: number) => formatMoney(minor, currency);
  const row = "flex justify-between gap-4 py-1.5";
  return (
    <dl className="text-sm">
      <div className={row}>
        <dt className="text-smoke">{t("subtotal")}</dt>
        <dd className="font-semibold">{money(subtotalCents)}</dd>
      </div>
      {discountCents > 0 ? (
        <div className={row}>
          <dt className="text-smoke">
            {couponCode ? t("discountWithCode", { code: couponCode }) : t("discount")}
          </dt>
          <dd className="font-semibold text-sage">−{money(discountCents)}</dd>
        </div>
      ) : null}
      <div className={row}>
        <dt className="text-smoke">{t("shipping")}</dt>
        <dd className="font-semibold">
          {shippingCents > 0
            ? money(shippingCents)
            : final
              ? t("free")
              : t("calculatedAtCheckout")}
        </dd>
      </div>
      <div className={row}>
        <dt className="text-smoke">{t("vat")}</dt>
        <dd className="font-semibold">
          {taxCents === 0 && !final ? t("calculatedAtCheckout") : money(taxCents)}
        </dd>
      </div>
      <div className={`${row} mt-2 border-t border-line pt-3 text-base`}>
        <dt className="font-display text-lg">{t("total")}</dt>
        <dd className="font-display text-lg">{money(totalCents)}</dd>
      </div>
    </dl>
  );
}

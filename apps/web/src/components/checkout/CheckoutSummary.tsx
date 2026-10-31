import { useTranslations } from "next-intl";
import { formatMoney, type Cart, type Totals } from "@hp/contracts";
import { OrderSummary } from "@/components/cart/OrderSummary";

type Props = { cart: Cart; intentTotals: Totals | null };

/** Lines from the server cart; totals from the cart, then from the checkout intent. */
export function CheckoutSummary({ cart, intentTotals }: Props) {
  const t = useTranslations("Checkout");
  const cartText = useTranslations("Cart");
  return (
    <aside
      aria-label={t("summaryHeading")}
      className="h-fit rounded-[var(--radius-pan)] bg-crust p-6 shadow-[var(--shadow-plate)] lg:sticky lg:top-36"
    >
      <h2 className="mb-4 text-2xl">{t("summaryHeading")}</h2>
      <ul className="mb-4 divide-y divide-line text-sm">
        {cart.items.map((line) => (
          <li key={line.id} className="flex justify-between gap-4 py-2">
            <span>
              <span className="font-semibold">{line.productName}</span>
              <span className="block text-smoke">
                {line.variantName} · {cartText("qty", { count: line.quantity })}
              </span>
            </span>
            <span className="font-semibold">{formatMoney(line.lineTotalCents, cart.currency)}</span>
          </li>
        ))}
      </ul>
      <div aria-live="polite">
        <OrderSummary
          totals={intentTotals ?? cart.totals}
          currency={cart.currency}
          couponCode={cart.couponCode}
          final={intentTotals !== null}
        />
      </div>
      {intentTotals ? null : (
        <p className="mt-3 text-xs text-smoke">{t("shippingVatNote")}</p>
      )}
    </aside>
  );
}

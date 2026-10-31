import { useTranslations } from "next-intl";
import { formatMoney, type OrderDetail } from "@hp/contracts";
import { OrderSummary } from "@/components/cart/OrderSummary";

/** Items and the server's final totals for an order. */
export function OrderItems({ order }: { order: OrderDetail }) {
  const t = useTranslations("Account.orders");
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_300px]">
      <ul aria-label={t("itemsLabel")} className="divide-y divide-line">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4 py-3">
            <span>
              <span className="font-semibold">{item.productName}</span>
              <span className="block text-sm text-smoke">
                {t("qtyEach", {
                  variant: item.variantName,
                  quantity: item.quantity,
                  price: formatMoney(item.unitPriceCents, order.currency),
                })}
              </span>
            </span>
            <span className="font-semibold">
              {formatMoney(item.lineTotalCents, order.currency)}
            </span>
          </li>
        ))}
      </ul>
      <OrderSummary
        totals={order.totals}
        currency={order.currency}
        couponCode={order.couponCode}
        final
      />
    </div>
  );
}

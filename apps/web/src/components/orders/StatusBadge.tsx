import { useTranslations } from "next-intl";
import type { OrderStatus, PaymentMethod } from "@hp/contracts";

const TONES: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "bg-butter/50 text-iron",
  PAID: "bg-enamel-wash text-enamel",
  PROCESSING: "bg-enamel-wash text-enamel",
  SHIPPED: "bg-sage-wash text-sage",
  DELIVERED: "bg-sage-wash text-sage",
  CANCELLED: "bg-parchment text-smoke",
  REFUNDED: "bg-danger-wash text-danger",
};

/** Status as text plus colour, never colour alone. */
export function StatusBadge({
  status,
  paymentMethod,
}: {
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
}) {
  const t = useTranslations("Order.status");
  // A transfer order waiting for money says so; everything else uses the plain label.
  const key =
    status === "PENDING_PAYMENT" && paymentMethod === "bank_transfer"
      ? "PENDING_PAYMENT_TRANSFER"
      : status;
  return (
    <span className={`inline-flex rounded-sm px-3 py-1 text-sm font-semibold ${TONES[status]}`}>
      {t(key)}
    </span>
  );
}

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney, type OrderDetail, type OrderEvent } from "@hp/contracts";
import { BankTransferPanel } from "@/components/payments/BankTransferPanel";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
import { DEFAULT_LOCALE, intlLocale, isLocale } from "@/i18n/config";
import { useGovernorateName } from "@/lib/use-governorate-name";
import { formatDateIn, formatDateTimeIn, formatDueDateTimeIn } from "@/lib/format";
import { OrderItems } from "./OrderItems";
import { OrderTracker } from "./OrderTracker";
import { StatusBadge } from "./StatusBadge";

type Translate = ReturnType<typeof useTranslations<"Order">>;

function refundText(order: OrderDetail, t: Translate): string | null {
  const amount = formatMoney(order.refundedCents, order.currency);
  if (order.refundState === "FULL") return t("refundFull", { amount });
  if (order.refundState === "PARTIAL") return t("refundPartial", { amount });
  return null;
}

function paymentText(order: OrderDetail, t: Translate): string {
  // An admin-defined method is named by the admin; the built-in ones come from the messages.
  const method =
    order.paymentMethod === "manual" && order.paymentLabel
      ? order.paymentLabel
      : t(`method.${order.paymentMethod}`);
  return order.paidAt === null ? t("paymentPending", { method }) : t("paidBy", { method });
}

/** Shown while a transfer order waits for the money: what to pay, where, and by when. */
function AwaitingTransfer({ order, locale }: { order: OrderDetail; locale: string }) {
  const t = useTranslations("Order");
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  if (order.manualPayment) {
    return (
      <ManualPaymentPanel
        payment={order.manualPayment}
        currency={order.currency}
        title={t("awaitingManualTitle", { label: order.manualPayment.label })}
      >
        <p className="text-sm">
          {t.rich("heldUntilManual", {
            deadline: formatDueDateTimeIn(order.manualPayment.dueAt, locale),
            strong,
          })}
        </p>
      </ManualPaymentPanel>
    );
  }
  if (!order.bankTransfer) return null;
  return (
    <BankTransferPanel
      transfer={order.bankTransfer}
      currency={order.currency}
      title={t("awaitingTransferTitle")}
    >
      <p className="text-sm">
        {t.rich("heldUntil", {
          deadline: formatDueDateTimeIn(order.bankTransfer.dueAt, locale),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
    </BankTransferPanel>
  );
}

function eventText(event: OrderEvent, t: Translate): string {
  // A message written by the shop (e.g. an admin note) is shown as it was written.
  if (event.message) return event.message;
  if (event.toStatus) return t(`status.${event.toStatus}`);
  return event.type.replace(/_/g, " ");
}

/** Everything about an order; `actions` holds e.g. the cancel control. */
export function OrderDetailBody({ order, actions }: { order: OrderDetail; actions?: ReactNode }) {
  const t = useTranslations("Order");
  const governorate = useGovernorateName();
  const rawLocale = useLocale();
  const locale = intlLocale(isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE);
  const refund = refundText(order, t);
  const address = order.shippingAddress;
  return (
    <article className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="stamp">{t("placedOn", { date: formatDateIn(order.createdAt, locale) })}</p>
          <h1 className="mt-1 font-mono text-3xl">{order.number}</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={order.status} paymentMethod={order.paymentMethod} />
          {refund ? <p className="text-sm font-semibold text-danger">{refund}</p> : null}
        </div>
      </header>

      <OrderTracker order={order} />

      {actions}

      <AwaitingTransfer order={order} locale={locale} />

      <section aria-label={t("itemsAndTotals")} className="rounded-sm bg-crust p-6">
        <OrderItems order={order} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-sm bg-crust p-5">
          <h2 className="mb-2 text-xl">{t("shipping")}</h2>
          <address className="text-sm not-italic text-smoke">
            {address.fullName}
            <br />
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ""}
            <br />
            {address.city}, {governorate(address.region)} {address.postalCode}
            {address.phone ? (
              <>
                <br />
                <bdi>{address.phone}</bdi>
              </>
            ) : null}
          </address>
          <p className="mt-2 text-sm">{t(`shippingMethod.${order.shippingMethod}`)}</p>
          <p className="mt-1 text-sm">{paymentText(order, t)}</p>
        </section>

        <section className="rounded-sm bg-crust p-5">
          <h2 id="timeline-heading" className="mb-2 text-xl">
            {t("timeline")}
          </h2>
          <ol aria-label={t("timelineLabel")} className="space-y-3 border-s-2 border-line ps-4">
            {order.events.map((event) => (
              <li key={event.id} className="relative text-sm">
                <span
                  aria-hidden="true"
                  className="absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full bg-ember"
                />
                <span className="font-semibold">{eventText(event, t)}</span>
                <span className="block text-smoke">
                  <time dateTime={event.createdAt}>{formatDateTimeIn(event.createdAt, locale)}</time>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}

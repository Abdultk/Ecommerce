import { useLocale, useTranslations } from "next-intl";
import type { OrderDetail } from "@hp/contracts";
import { formatDateIn, formatDateTimeIn } from "@/lib/format";
import { buildTracker, type TrackerInput, type TrackerState } from "@/lib/order-tracker";
import { DEFAULT_LOCALE, intlLocale, isLocale } from "@/i18n/config";

const BAR: Readonly<Record<TrackerState, string>> = {
  done: "bg-forest",
  current: "bg-copper",
  upcoming: "bg-line",
};

/** Orders that have not shipped yet: a tracking number will appear, but there is none today. */
const AWAITING_SHIPMENT = new Set(["PENDING_PAYMENT", "PAID", "PROCESSING"]);

/**
 * Where an order is, from its real status and recorded events. Nothing here is estimated: a stage
 * that has not happened shows no time. The bar is a grid, so it reads right to left in Arabic.
 */
export function OrderTracker({
  order,
}: {
  order: TrackerInput & Pick<OrderDetail, "trackingNumber" | "carrier" | "estimatedDeliveryAt">;
}) {
  const t = useTranslations("Order.tracker");
  const tOrder = useTranslations("Order");
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const steps = buildTracker(order);

  return (
    <section aria-labelledby="tracker-heading" className="space-y-4">
      <h2 id="tracker-heading" className="text-xl">
        {t("heading")}
      </h2>
      <ol
        className="grid gap-x-3 gap-y-5"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step) => (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className="space-y-2"
          >
            <span aria-hidden="true" className={`block h-1.5 rounded-sm ${BAR[step.state]}`} />
            <p className={`text-sm leading-snug ${step.state === "upcoming" ? "text-smoke" : "font-semibold"}`}>
              <span className="sr-only">{t(`state.${step.state}`)}: </span>
              {t(`step.${step.key}`)}
            </p>
            {step.at ? (
              <p className="text-xs text-smoke">
                <time dateTime={step.at}>{formatDateTimeIn(step.at, intlLocale(locale))}</time>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {order.carrier || order.trackingNumber || order.estimatedDeliveryAt ? (
        <dl className="space-y-1 text-sm">
          {order.carrier ? (
            <div className="flex gap-2">
              <dt className="text-smoke">{t("carrier")}</dt>
              <dd>{order.carrier}</dd>
            </div>
          ) : null}
          {order.trackingNumber ? (
            <div className="flex gap-2">
              <dt className="text-smoke">{tOrder("trackingNumber")}</dt>
              <dd>
                <bdi className="font-mono">{order.trackingNumber}</bdi>
              </dd>
            </div>
          ) : null}
          {order.estimatedDeliveryAt && order.status !== "DELIVERED" ? (
            <div className="flex gap-2">
              <dt className="text-smoke">{t("expectedBy")}</dt>
              <dd>
                <time dateTime={order.estimatedDeliveryAt}>
                  {formatDateIn(order.estimatedDeliveryAt, intlLocale(locale))}
                </time>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : AWAITING_SHIPMENT.has(order.status) ? (
        <p className="text-sm text-smoke">{t("noTrackingYet")}</p>
      ) : null}
    </section>
  );
}

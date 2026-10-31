import { useId, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  currencyExponent,
  formatMoney,
  type CurrencyCode,
  type ManualPaymentDetails,
} from "@hp/contracts";
import { intlLocale, type Locale } from "@/i18n/config";
import { formatDueDateTimeIn } from "@/lib/format";
import { CopyButton } from "./CopyButton";

type Props = {
  payment: ManualPaymentDetails;
  currency: CurrencyCode;
  title: string;
  /** Extra text under the title, e.g. how long the order is held. */
  children?: ReactNode;
};

/** The amount as a plain number for pasting into a payment app ("23.725"). */
const plainAmount = (minor: number, currency: CurrencyCode) =>
  (minor / 10 ** currencyExponent(currency)).toFixed(currencyExponent(currency));

/**
 * How to pay with a method the shop's admin defined: amount, order reference, deadline, and the
 * admin's own instructions (shown as written, so they can name an account, a wallet or a courier).
 */
export function ManualPaymentPanel({ payment, currency, title, children }: Props) {
  const headingId = useId();
  const t = useTranslations("BankTransfer");
  const locale = useLocale() as Locale;
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-[var(--radius-pan)] border-2 border-butter bg-crust p-6 shadow-[var(--shadow-plate)]"
    >
      <h2 id={headingId} className="text-2xl">
        {title}
      </h2>
      {children}
      <dl className="divide-y divide-line text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 py-2">
          <dt className="text-smoke">{t("amount")}</dt>
          <dd className="flex flex-wrap items-center gap-2 text-end">
            <strong>{formatMoney(payment.amountCents, currency)}</strong>
            <CopyButton
              value={plainAmount(payment.amountCents, currency)}
              label={t("what.amount")}
            />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 py-2">
          <dt className="text-smoke">{t("reference")}</dt>
          <dd className="flex flex-wrap items-center gap-2 text-end">
            <bdi className="font-mono">{payment.reference}</bdi>
            <CopyButton value={payment.reference} label={t("what.reference")} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 py-2">
          <dt className="text-smoke">{t("payBy")}</dt>
          <dd className="text-end">
            <time dateTime={payment.dueAt}>
              {formatDueDateTimeIn(payment.dueAt, intlLocale(locale))}
            </time>
          </dd>
        </div>
      </dl>
      <p className="whitespace-pre-line break-words">{payment.instructions}</p>
    </section>
  );
}

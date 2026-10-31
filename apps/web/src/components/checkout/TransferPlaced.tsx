"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { BankTransferDetails, CheckoutIntent } from "@hp/contracts";
import { BankTransferPanel } from "@/components/payments/BankTransferPanel";
import { formatDueDateTimeIn } from "@/lib/format";
import { intlLocale, type Locale } from "@/i18n/config";

type Props = { intent: CheckoutIntent; transfer: BankTransferDetails; email?: string };

/** The order is placed and stock is held; the customer now pays from their bank. */
export function TransferPlaced({ intent, transfer, email }: Props) {
  const t = useTranslations("Checkout.transfer");
  const locale = useLocale() as Locale;
  const heading = useRef<HTMLHeadingElement>(null);
  // The checkout steps are replaced by this view, so move focus to its heading.
  useEffect(() => heading.current?.focus(), []);

  const tags = {
    strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
    // Order numbers are Latin letters and digits; <bdi> keeps RTL text from reordering them.
    mono: (chunks: React.ReactNode) => (
      <strong className="font-mono [unicode-bidi:isolate]">{chunks}</strong>
    ),
  };

  return (
    <div className="space-y-6">
      <div className="tile-bg space-y-3 rounded-[var(--radius-pan)] p-6 sm:p-10">
        <p className="stamp">{t("stamp")}</p>
        <h2 ref={heading} tabIndex={-1} className="text-3xl focus:outline-none">
          {t("heading")}
        </h2>
        <p>
          {t.rich("held", {
            ...tags,
            orderNumber: intent.orderNumber,
            deadline: formatDueDateTimeIn(transfer.dueAt, intlLocale(locale)),
          })}
        </p>
        <p>{email ? t.rich("noteEmail", { ...tags, email }) : t("note")}</p>
      </div>
      <BankTransferPanel
        transfer={transfer}
        currency={intent.currency}
        title={t("panelTitle")}
      />
    </div>
  );
}

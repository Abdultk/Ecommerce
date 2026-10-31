import { useId, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  currencyExponent,
  formatMoney,
  type BankTransferDetails,
  type CurrencyCode,
} from "@hp/contracts";
import { intlLocale, type Locale } from "@/i18n/config";
import { formatDueDateTimeIn } from "@/lib/format";
import { CopyButton } from "./CopyButton";

type Props = {
  transfer: BankTransferDetails;
  currency: CurrencyCode;
  title: string;
  /** Extra text under the title, e.g. how long the order is held. */
  children?: ReactNode;
};

/** IBANs are easier to read and check in groups of four. */
const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");

/** The amount as a plain number for pasting into a banking app ("23.725"). */
const plainAmount = (minor: number, currency: CurrencyCode) =>
  (minor / 10 ** currencyExponent(currency)).toFixed(currencyExponent(currency));

type Row = { term: string; value: ReactNode; copy?: { value: string; label: string } };

type Translate = ReturnType<typeof useTranslations<"BankTransfer">>;

function rowsFor(
  { reference, amountCents, dueAt, bank }: BankTransferDetails,
  currency: CurrencyCode,
  t: Translate,
  locale: Locale,
): Row[] {
  // Bank details are Latin text and digits; <bdi> keeps them from being reordered in RTL.
  const rows: Row[] = [
    {
      term: t("amount"),
      value: <strong>{formatMoney(amountCents, currency)}</strong>,
      copy: { value: plainAmount(amountCents, currency), label: t("what.amount") },
    },
    {
      term: t("reference"),
      value: <bdi className="font-mono">{reference}</bdi>,
      copy: { value: reference, label: t("what.reference") },
    },
    { term: t("bank"), value: <bdi>{bank.bankName}</bdi> },
    { term: t("accountName"), value: <bdi>{bank.accountName}</bdi> },
    {
      term: t("accountNumber"),
      value: <bdi className="font-mono">{bank.accountNumber}</bdi>,
      copy: { value: bank.accountNumber, label: t("what.accountNumber") },
    },
    {
      term: t("iban"),
      value: <bdi className="font-mono">{groupIban(bank.iban)}</bdi>,
      copy: { value: bank.iban, label: t("what.iban") },
    },
  ];
  const swift: Row[] = bank.swift ? [{ term: t("swift"), value: <bdi>{bank.swift}</bdi> }] : [];
  const due: Row = {
    term: t("payBy"),
    value: <time dateTime={dueAt}>{formatDueDateTimeIn(dueAt, intlLocale(locale))}</time>,
  };
  return [...rows, ...swift, due];
}

/** Everything a customer needs to pay by bank transfer, with copy buttons for the details. */
export function BankTransferPanel({ transfer, currency, title, children }: Props) {
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
        {rowsFor(transfer, currency, t, locale).map((row) => (
          <div key={row.term} className="flex flex-wrap items-center justify-between gap-x-4 py-2">
            <dt className="text-smoke">{row.term}</dt>
            <dd className="flex flex-wrap items-center gap-2 text-end">
              <span className="break-all">{row.value}</span>
              {row.copy ? <CopyButton value={row.copy.value} label={row.copy.label} /> : null}
            </dd>
          </div>
        ))}
      </dl>
      {transfer.bank.instructions ? (
        <p className="text-sm text-smoke">{transfer.bank.instructions}</p>
      ) : null}
    </section>
  );
}

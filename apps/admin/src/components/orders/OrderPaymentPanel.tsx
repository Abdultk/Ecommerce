import {
  formatMoney,
  type AdminOrderDetail,
  type BankTransferDetails,
  type ManualPaymentDetails,
} from "@hp/contracts";
import { formatDateTime, paymentMethodLabel } from "@/lib/format";

const PROVIDER_LABELS = {
  amwal: "Amwal Pay",
  stripe: "Stripe",
  fake: "Test provider",
  manual: "Manual",
} as const;

/** How the order is (or will be) paid: card provider reference or bank-transfer details. */
export function OrderPaymentPanel({ detail }: { detail: AdminOrderDetail }) {
  const { order } = detail;
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-muted">Method: </span>
        {order.paymentLabel ?? paymentMethodLabel(order.paymentMethod)}
      </p>
      {order.bankTransfer && (
        <AwaitingTransfer transfer={order.bankTransfer} currency={order.currency} />
      )}
      {order.manualPayment && (
        <AwaitingManual payment={order.manualPayment} currency={order.currency} />
      )}
      {order.paymentMethod !== "card" ? <TransferRecord detail={detail} /> : null}
      {order.paymentMethod === "card" && <CardRecord detail={detail} />}
      {order.paidAt && <p className="text-xs text-muted">Paid {formatDateTime(order.paidAt)}</p>}
      {!order.paidAt && !order.bankTransfer && !order.manualPayment && (
        <p className="text-muted">No payment yet.</p>
      )}
    </div>
  );
}

function CardRecord({ detail }: { detail: AdminOrderDetail }) {
  const { paymentIntentId, paymentProvider } = detail;
  if (!paymentIntentId) return null;
  return (
    <>
      <p>
        {paymentProvider ? PROVIDER_LABELS[paymentProvider] : "Card"} payment{" "}
        <code className="font-mono text-xs">{paymentIntentId}</code>
      </p>
      {paymentProvider === "stripe" && (
        <a
          href={`https://dashboard.stripe.com/payments/${encodeURIComponent(paymentIntentId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-link"
        >
          Open in Stripe<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </>
  );
}

function TransferRecord({ detail }: { detail: AdminOrderDetail }) {
  if (!detail.transferBankReference) return null;
  return (
    <p>
      Transfer confirmed
      {detail.transferConfirmedByEmail && ` by ${detail.transferConfirmedByEmail}`}, bank reference{" "}
      <code className="font-mono text-xs">{detail.transferBankReference}</code>
    </p>
  );
}

/** What the customer was told to do, as it was when they ordered (later edits don't change it). */
function AwaitingManual({
  payment,
  currency,
}: {
  payment: ManualPaymentDetails;
  currency: AdminOrderDetail["order"]["currency"];
}) {
  const rows: [string, string][] = [
    ["Amount", formatMoney(payment.amountCents, currency)],
    ["Reference", payment.reference],
    ["Due", formatDateTime(payment.dueAt)],
  ];
  return (
    <div className="space-y-2 rounded-md border border-line bg-paper p-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-xs break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="whitespace-pre-line break-words text-xs text-muted">{payment.instructions}</p>
    </div>
  );
}

type AwaitingProps = {
  transfer: BankTransferDetails;
  currency: AdminOrderDetail["order"]["currency"];
};

/** What the customer was asked to pay, so staff can match it against the bank statement. */
function AwaitingTransfer({ transfer, currency }: AwaitingProps) {
  const { bank } = transfer;
  const rows: [string, string][] = [
    ["Amount", formatMoney(transfer.amountCents, currency)],
    ["Reference", transfer.reference],
    ["Due", formatDateTime(transfer.dueAt)],
    ["Bank", bank.bankName],
    ["Account name", bank.accountName],
    ["IBAN", bank.iban],
    ...(bank.swift ? ([["SWIFT", bank.swift]] as [string, string][]) : []),
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-line bg-paper p-3">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="font-mono text-xs break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

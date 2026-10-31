import type { OrderStatus, RefundState } from "@hp/contracts";
import { formatDateTime, orderStatusLabel } from "@/lib/format";

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "badge-neutral",
  PAID: "badge-warn",
  PROCESSING: "badge-warn",
  SHIPPED: "badge-ok",
  DELIVERED: "badge-ok",
  CANCELLED: "badge-muted",
  REFUNDED: "badge-muted",
};

/** Status always carries its text; colour is a secondary cue. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{orderStatusLabel(status)}</span>;
}

const REFUND_LABELS: Record<RefundState, string> = {
  NONE: "Not refunded",
  PARTIAL: "Partly refunded",
  FULL: "Fully refunded",
};

export const refundStateLabel = (state: RefundState): string => REFUND_LABELS[state];

/** A bank-transfer order still waiting for the money; stock is held until `dueAt`. */
export function AwaitingTransferBadge({ dueAt }: { dueAt: string }) {
  return <span className="badge badge-warn">Awaiting transfer · due {formatDateTime(dueAt)}</span>;
}

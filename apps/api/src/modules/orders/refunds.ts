import type { Order, OrderStatus } from "@prisma/client";
import { canRefund, canTransition } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import type { PaymentGateway } from "../../lib/payments";
import type { Db, DbClient } from "../../lib/prisma";
import { isOffline } from "./order-view";
import { lockOrder } from "./stock";

/** Actor recorded for refunds the system or the provider made on its own. */
export const SYSTEM_ACTOR = "system";

/** Writes an audit entry inside the transaction that changes the order, so neither lands alone. */
export type AuditInTx = (tx: DbClient, before: Order) => Promise<void>;

type RefundRecord = {
  providerRefundId: string;
  /** "stripe" | "amwal" | "fake" | "manual" */
  provider: string;
  amountCents: number;
  reason?: string | null;
  bankReference?: string | null;
  actorId: string;
};

/**
 * Records a refund (idempotent by refund id). A refund that brings the order to its full
 * total moves it to REFUNDED when the status machine allows it.
 */
export async function recordRefund(
  tx: DbClient,
  orderId: string,
  refund: RefundRecord,
): Promise<boolean> {
  const existing = await tx.refund.findUnique({
    where: { providerRefundId: refund.providerRefundId },
  });
  if (existing) return false;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const amount = Math.min(refund.amountCents, order.totalCents - order.refundedCents);
  if (amount <= 0) return false;

  const refundedCents = order.refundedCents + amount;
  const toStatus: OrderStatus | null =
    refundedCents === order.totalCents && canTransition(order.status, "REFUNDED")
      ? "REFUNDED"
      : null;
  await tx.refund.create({
    data: {
      orderId,
      amountCents: amount,
      reason: refund.reason ?? null,
      providerRefundId: refund.providerRefundId,
      provider: refund.provider,
      bankReference: refund.bankReference ?? null,
      actorId: refund.actorId,
    },
  });
  await tx.order.update({
    where: { id: orderId },
    data: { refundedCents, ...(toStatus && { status: toStatus }) },
  });
  await tx.orderEvent.create({
    data: {
      orderId,
      type: "refunded",
      fromStatus: toStatus ? order.status : null,
      toStatus,
      message: `Refunded ${amount}${refund.bankReference ? ` (bank ref ${refund.bankReference})` : ""}${refund.reason ? `: ${refund.reason}` : ""}`,
      actorId: refund.actorId === SYSTEM_ACTOR ? null : refund.actorId,
    },
  });
  return true;
}

type RefundRequest = { amountCents: number; reason?: string; bankReference?: string };
type RefundOptions = { audit?: AuditInTx; providerKey?: string | null };
type RefundDeps = { db: Db; payments: PaymentGateway };

function assertRefundable(order: Order, input: RefundRequest): void {
  const transfer = isOffline(order.paymentMethod);
  if (!canRefund(order.status) || (!transfer && !order.providerPaymentId)) {
    throw new AppError("CONFLICT", "This order can't be refunded.");
  }
  if (transfer && !input.bankReference) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Bank-transfer and manual-payment orders are refunded manually: enter the reference of your refund.",
    );
  }
  const refundable = order.totalCents - order.refundedCents;
  if (input.amountCents > refundable) {
    throw new AppError("VALIDATION_ERROR", `At most ${refundable} can be refunded.`, {
      refundableCents: refundable,
    });
  }
}

/**
 * Card orders: refunds through the provider, then records it. Bank-transfer orders: the
 * admin has already sent the money back; we only record it with their bank reference
 * (provider "manual", no provider call).
 */
export async function refundOrder(
  deps: RefundDeps,
  orderId: string,
  input: RefundRequest,
  actorId: string,
  options: RefundOptions = {},
): Promise<void> {
  const order = await deps.db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  assertRefundable(order, input);
  const manual = isOffline(order.paymentMethod);
  // With an admin Idempotency-Key the provider key comes from it, so a retried request
  // reaches the same provider refund even after the first one changed refundedCents.
  // Without one: same order state + amount → same key, so a double submit can't refund twice.
  const refundId = manual
    ? `manual_${options.providerKey ?? `${order.id}:${order.refundedCents}:${input.amountCents}`}`
    : (
        await deps.payments.refund({
          paymentId: order.providerPaymentId!,
          amountCents: input.amountCents,
          reason: input.reason ?? "Refund",
          idempotencyKey: options.providerKey
            ? `refund:${order.id}:admin:${options.providerKey}`
            : `refund:${order.id}:${order.refundedCents}:${input.amountCents}`,
        })
      ).id;
  await deps.db.$transaction(async (tx) => {
    await lockOrder(tx, order.id);
    const before = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    await recordRefund(tx, order.id, {
      providerRefundId: refundId,
      provider: manual ? "manual" : (order.paymentProvider ?? deps.payments.provider),
      amountCents: input.amountCents,
      reason: input.reason,
      bankReference: manual ? input.bankReference : null,
      actorId,
    });
    await options.audit?.(tx, before);
  });
}

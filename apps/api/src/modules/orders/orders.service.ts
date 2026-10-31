import type { Order, OrderStatus } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { safeErrorFields } from "../../lib/safe-error";
import { capturePaymentError } from "../../lib/sentry";
import type { Mailer, OutgoingMail } from "../../lib/mailer";
import type { PaymentGateway, PaymentRef } from "../../lib/payments";
import type { Db, DbClient } from "../../lib/prisma";
import { orderCancelledEmail, transferExpiredEmail } from "./emails";
import { ORDER_DETAIL_INCLUDE, isOffline, type OrderWithLines } from "./order-view";
import { SYSTEM_ACTOR, recordRefund, type AuditInTx } from "./refunds";
import { lockOrder, releaseReservation, returnToStock } from "./stock";

export { SYSTEM_ACTOR, recordRefund, refundOrder, type AuditInTx } from "./refunds";

export type OrderDeps = { db: Db; payments: PaymentGateway; mailer: Mailer };

const EXPIRY_BATCH = 100;

/** The provider reference of a card order, or null (transfers never touch a provider). */
export const paymentRefOf = (
  order: Pick<Order, "providerPaymentId" | "providerSessionId">,
): PaymentRef | null =>
  order.providerPaymentId || order.providerSessionId
    ? { paymentId: order.providerPaymentId, sessionId: order.providerSessionId }
    : null;

/** Cancelling at the provider is best effort: a late payment is refunded automatically. */
export async function cancelPaymentQuietly(payments: PaymentGateway, ref: PaymentRef | null) {
  if (!ref) return;
  try {
    await payments.cancelPayment(ref);
  } catch (err) {
    logger.warn({ err: safeErrorFields(err) }, "could not cancel payment at the provider");
  }
}

async function sendQuietly(mailer: Mailer, mail: OutgoingMail, orderId: string) {
  try {
    await mailer.send(mail);
  } catch (err) {
    logger.error({ err: safeErrorFields(err), orderId }, "could not send order email");
  }
}

/** Cancels an unpaid order inside a transaction that already holds its row lock. */
export async function cancelPendingInTx(
  tx: DbClient,
  order: OrderWithLines,
  type: string,
  message: string,
  actorId: string | null = null,
): Promise<void> {
  await releaseReservation(tx, order.items);
  await tx.order.update({
    where: { id: order.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), reservationExpiresAt: null },
  });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type,
      fromStatus: order.status,
      toStatus: "CANCELLED",
      message,
      actorId,
    },
  });
}

/** Cancels one lapsed order under its lock; returns it, or null if something else won the race. */
async function expireOne(db: Db, id: string, now: Date): Promise<Order | null> {
  return db.$transaction(async (tx) => {
    await lockOrder(tx, id);
    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      include: ORDER_DETAIL_INCLUDE,
    });
    // Re-check under the lock: a payment (or an admin's transfer confirmation) may have won.
    const lapsed =
      order.status === "PENDING_PAYMENT" &&
      order.reservationExpiresAt !== null &&
      order.reservationExpiresAt < now;
    if (!lapsed) return null;
    const transfer = isOffline(order.paymentMethod);
    const bank = order.paymentMethod === "BANK_TRANSFER";
    await cancelPendingInTx(
      tx,
      order,
      transfer ? "transfer_expired" : "reservation_expired",
      transfer
        ? `The ${bank ? "bank transfer" : "payment"} didn't arrive in time.`
        : "Payment wasn't completed in time.",
    );
    return order;
  });
}

/**
 * Cancels unpaid orders whose hold has lapsed and returns the stock to sale: card checkouts
 * after RESERVATION_TTL_MINUTES, bank transfers after the settings' hold (24 h by default).
 * Transfer customers are emailed that the order was cancelled. Runs on the worker every minute.
 */
export async function releaseExpiredReservations(
  deps: OrderDeps,
  now: Date = new Date(),
): Promise<number> {
  const due = await deps.db.order.findMany({
    where: { status: "PENDING_PAYMENT", reservationExpiresAt: { lt: now } },
    select: { id: true },
    orderBy: { reservationExpiresAt: "asc" },
    take: EXPIRY_BATCH,
  });
  let cancelled = 0;
  for (const { id } of due) {
    const order = await expireOne(deps.db, id, now);
    if (!order) continue;
    cancelled += 1;
    if (isOffline(order.paymentMethod)) {
      await sendQuietly(deps.mailer, transferExpiredEmail(order), order.id);
    } else {
      await cancelPaymentQuietly(deps.payments, paymentRefOf(order));
    }
  }
  return cancelled;
}

// ---------- Cancellation ----------

export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ["PENDING_PAYMENT", "PAID"];
export const ADMIN_CANCELLABLE: readonly OrderStatus[] = ["PENDING_PAYMENT", "PAID", "PROCESSING"];

type CancelOptions = {
  allowed: readonly OrderStatus[];
  actorId: string | null;
  reason?: string;
  /** False for staff without order:refund: they may cancel unpaid orders only. */
  mayRefund: boolean;
  /** Runs in the cancelling transaction, after the status change. */
  audit?: AuditInTx;
  /** From the admin's Idempotency-Key: makes the provider refund key stable across retries. */
  providerKey?: string | null;
};

type CancelOutcome = {
  order: Order;
  wasPending: boolean;
  refund: { paymentId: string; amountCents: number; key: string } | null;
};

async function cancelPaidInTx(
  tx: DbClient,
  order: OrderWithLines,
  options: CancelOptions,
): Promise<CancelOutcome> {
  const refundDue = order.totalCents - order.refundedCents;
  if (refundDue > 0 && isOffline(order.paymentMethod)) {
    // There is no provider to refund through: staff send the money back and record it.
    throw new AppError(
      "CONFLICT",
      "This order was paid offline (bank transfer or a manual method). Refund it manually (with your reference) instead of cancelling.",
    );
  }
  if (refundDue > 0 && !options.mayRefund) {
    throw new AppError(
      "FORBIDDEN",
      "Cancelling a paid order refunds it. Ask someone who can issue refunds.",
    );
  }
  await returnToStock(tx, order.id, order.items, options.actorId);
  const cancelled = await tx.order.update({
    where: { id: order.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: "cancelled",
      fromStatus: order.status,
      toStatus: "CANCELLED",
      message: options.reason ?? "Order cancelled.",
      actorId: options.actorId,
    },
  });
  await options.audit?.(tx, order);
  const refund =
    refundDue > 0 && order.providerPaymentId
      ? {
          paymentId: order.providerPaymentId,
          amountCents: refundDue,
          key: options.providerKey
            ? `cancel:${order.id}:admin:${options.providerKey}`
            : `cancel:${order.id}:${order.refundedCents}`,
        }
      : null;
  return { order: cancelled, wasPending: false, refund };
}

/** Decides and applies the cancellation under the order lock; no provider calls inside. */
async function cancelInTx(
  tx: DbClient,
  orderId: string,
  options: CancelOptions,
): Promise<CancelOutcome> {
  if (!(await lockOrder(tx, orderId))) throw new AppError("NOT_FOUND", "Order not found.");
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: ORDER_DETAIL_INCLUDE,
  });
  if (!options.allowed.includes(order.status)) {
    throw new AppError("CONFLICT", "This order can no longer be cancelled.");
  }
  if (order.status !== "PENDING_PAYMENT") return cancelPaidInTx(tx, order, options);
  await cancelPendingInTx(
    tx,
    order,
    "cancelled",
    options.reason ?? "Order cancelled.",
    options.actorId,
  );
  await options.audit?.(tx, order);
  return {
    order: await tx.order.findUniqueOrThrow({ where: { id: orderId } }),
    wasPending: true,
    refund: null,
  };
}

/** Refunds a cancelled paid order at the provider; on failure flags it for staff. */
async function refundCancelled(
  deps: OrderDeps,
  orderId: string,
  due: NonNullable<CancelOutcome["refund"]>,
  actorId: string | null,
): Promise<boolean> {
  try {
    const refund = await deps.payments.refund({
      paymentId: due.paymentId,
      amountCents: due.amountCents,
      idempotencyKey: due.key,
      reason: "Order cancelled",
    });
    await deps.db.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      await recordRefund(tx, orderId, {
        providerRefundId: refund.id,
        provider: deps.payments.provider,
        amountCents: due.amountCents,
        reason: "Order cancelled",
        actorId: actorId ?? SYSTEM_ACTOR,
      });
    });
    return true;
  } catch (err) {
    logger.error({ err: safeErrorFields(err), orderId }, "refund after cancellation failed");
    capturePaymentError(err, { step: "cancel_refund" });
    await deps.db.orderEvent.create({
      data: {
        orderId,
        type: "refund_failed",
        message: "Cancelled, but the refund failed; refund manually.",
      },
    });
    return false;
  }
}

/**
 * Cancels an order. The status change is committed first (so a cancelled order can never
 * be shipped); the refund of a paid card order follows. If the provider refuses the
 * refund, the order is flagged for staff and the caller gets PAYMENT_FAILED.
 */
export async function cancelOrder(
  deps: OrderDeps,
  orderId: string,
  options: CancelOptions,
): Promise<void> {
  const outcome = await deps.db.$transaction((tx) => cancelInTx(tx, orderId, options));
  if (outcome.wasPending) await cancelPaymentQuietly(deps.payments, paymentRefOf(outcome.order));
  const refunded = outcome.refund
    ? await refundCancelled(deps, orderId, outcome.refund, options.actorId)
    : true;
  const final = await deps.db.order.findUniqueOrThrow({ where: { id: orderId } });
  await sendQuietly(deps.mailer, orderCancelledEmail(final), orderId);
  if (!refunded) {
    throw new AppError(
      "PAYMENT_FAILED",
      "The order was cancelled, but the refund didn't go through. Our team has been alerted.",
    );
  }
}

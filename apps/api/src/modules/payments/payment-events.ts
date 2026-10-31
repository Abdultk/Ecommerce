import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { safeErrorFields } from "../../lib/safe-error";
import { capturePaymentError } from "../../lib/sentry";
import type { OutgoingMail } from "../../lib/mailer";
import type { PaymentEvent, PaymentRef } from "../../lib/payments";
import type { DbClient } from "../../lib/prisma";
import { orderConfirmationEmail } from "../orders/emails";
import { ORDER_DETAIL_INCLUDE, type OrderWithLines } from "../orders/order-view";
import { SYSTEM_ACTOR, recordRefund, type OrderDeps } from "../orders/orders.service";
import { commitSale, lockOrder } from "../orders/stock";

/** Work that must happen after the transaction commits (network calls). */
export type FollowUp = {
  mail: OutgoingMail[];
  /** `record: false` refunds without booking it against the order (it was never paid). */
  refund?: { orderId: string; paymentId: string; amountCents: number; record: boolean };
};

/** What was received. `transfer` is set when an admin confirmed a bank transfer. */
export type ReceivedPayment = {
  amountCents: number;
  providerPaymentId: string | null;
  transfer?: { bankReference: string; confirmedById: string; note?: string };
};

export type MarkPaidOutcome = "paid" | "already_handled" | "after_cancellation" | "amount_mismatch";

/** True only when the event-id marker itself collided, i.e. the event was already handled. */
const isDuplicateEvent = (err: unknown) => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const meta = err.meta as { modelName?: string; target?: string[] | string } | undefined;
  return meta?.modelName === "ProcessedWebhook" || String(meta?.target ?? "").includes("eventId");
};

/** Finds and locks the order a provider reference belongs to. */
export async function orderForRef(tx: DbClient, ref: PaymentRef): Promise<OrderWithLines | null> {
  const where = ref.paymentId
    ? { providerPaymentId: ref.paymentId }
    : ref.sessionId
      ? { providerSessionId: ref.sessionId }
      : null;
  const found = where && (await tx.order.findFirst({ where, select: { id: true } }));
  if (!found) return null;
  await lockOrder(tx, found.id);
  return tx.order.findUniqueOrThrow({ where: { id: found.id }, include: ORDER_DETAIL_INCLUDE });
}

async function commitPaid(tx: DbClient, order: OrderWithLines, payment: ReceivedPayment) {
  // Low-stock alerts come from the worker's deduplicated low-stock job, not from each sale.
  await commitSale(tx, order.id, order.items);
  const paid = await tx.order.update({
    where: { id: order.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      reservationExpiresAt: null,
      ...(payment.providerPaymentId && { providerPaymentId: payment.providerPaymentId }),
      ...(payment.transfer && {
        transferBankReference: payment.transfer.bankReference,
        transferConfirmedById: payment.transfer.confirmedById,
        transferConfirmedAt: new Date(),
      }),
    },
    include: { items: true },
  });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: payment.transfer ? "transfer_confirmed" : "payment_succeeded",
      fromStatus: "PENDING_PAYMENT",
      toStatus: "PAID",
      message: payment.transfer
        ? `Bank reference ${payment.transfer.bankReference}${payment.transfer.note ? `: ${payment.transfer.note}` : ""}`
        : null,
      actorId: payment.transfer?.confirmedById ?? null,
    },
  });
  if (order.couponCode) {
    await tx.coupon.updateMany({
      where: { code: order.couponCode },
      data: { redemptions: { increment: 1 } },
    });
  }
  if (order.cartId) {
    await tx.cartItem.deleteMany({ where: { cartId: order.cartId } });
    await tx.cart.updateMany({ where: { id: order.cartId }, data: { couponCode: null } });
  }
  return paid;
}

/**
 * The ONLY way an order becomes PAID: a verified provider confirmation (webhook, status
 * check or reconciliation) or an admin-confirmed bank transfer. Call with the order row
 * locked. The amount received must equal the order total; a card payment that doesn't match,
 * or that arrives after the order was cancelled, is refunded (as a follow-up).
 */
export async function markOrderPaid(
  tx: DbClient,
  order: OrderWithLines,
  payment: ReceivedPayment,
  followUp: FollowUp,
): Promise<MarkPaidOutcome> {
  const refundTo = payment.providerPaymentId;
  if (order.status === "CANCELLED") {
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "payment_after_cancellation",
        message: "Payment arrived after the order was cancelled; refunding.",
      },
    });
    if (refundTo) {
      followUp.refund = {
        orderId: order.id,
        paymentId: refundTo,
        amountCents: payment.amountCents,
        record: true,
      };
    }
    return "after_cancellation";
  }
  if (order.status !== "PENDING_PAYMENT") return "already_handled";
  if (payment.amountCents !== order.totalCents) {
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "payment_amount_mismatch",
        message: `Received ${payment.amountCents}; expected ${order.totalCents}. Refunding.`,
      },
    });
    if (refundTo) {
      followUp.refund = {
        orderId: order.id,
        paymentId: refundTo,
        amountCents: payment.amountCents,
        record: false,
      };
    }
    logger.error(
      { orderId: order.id, received: payment.amountCents, expected: order.totalCents },
      "payment amount mismatch",
    );
    return "amount_mismatch";
  }
  followUp.mail.push(orderConfirmationEmail(await commitPaid(tx, order, payment)));
  return "paid";
}

async function onSucceeded(
  tx: DbClient,
  event: Extract<PaymentEvent, { type: "payment_succeeded" }>,
  followUp: FollowUp,
) {
  const order = await orderForRef(tx, event.ref);
  if (!order) {
    logger.warn({ ref: event.ref }, "payment for unknown order");
    return;
  }
  await markOrderPaid(
    tx,
    order,
    { amountCents: event.amountCents, providerPaymentId: event.paymentId },
    followUp,
  );
}

async function onFailed(tx: DbClient, event: Extract<PaymentEvent, { type: "payment_failed" }>) {
  const order = await orderForRef(tx, event.ref);
  if (!order) return;
  // The shopper can retry until the reservation expires.
  await tx.orderEvent.create({
    data: { orderId: order.id, type: "payment_failed", message: event.message.slice(0, 500) },
  });
}

async function onRefunded(
  tx: DbClient,
  event: Extract<PaymentEvent, { type: "refunded" }>,
  provider: string,
) {
  const order = await orderForRef(tx, event.ref);
  if (!order) return;
  // Picks up refunds made outside the admin (e.g. the provider dashboard); known ids are skipped.
  for (const refund of event.refunds) {
    await recordRefund(tx, order.id, {
      providerRefundId: refund.id,
      provider,
      amountCents: refund.amountCents,
      reason: "Refunded at the payment provider",
      actorId: SYSTEM_ACTOR,
    });
  }
}

/**
 * "check_payment" events carry no trustworthy amount: ask the provider (outside any
 * transaction) and continue with what it says. Anything not yet succeeded is left for a
 * later webhook, status poll or the reconciliation job.
 */
async function resolveCheck(deps: OrderDeps, event: PaymentEvent): Promise<PaymentEvent | null> {
  if (event.type !== "check_payment") return event;
  const status = await deps.payments.getPaymentStatus(event.ref);
  if (status.status !== "succeeded" || !status.paymentId) return null;
  return {
    id: event.id,
    type: "payment_succeeded",
    ref: event.ref,
    paymentId: status.paymentId,
    amountCents: status.amountCents,
  };
}

/** Sends follow-up email; failures are logged, never thrown (the payment is already booked). */
export async function sendFollowUpMail(deps: OrderDeps, mail: readonly OutgoingMail[]) {
  for (const message of mail) {
    try {
      await deps.mailer.send(message);
    } catch (err) {
      logger.error(
        { err: safeErrorFields(err), subject: message.subject },
        "could not send order email",
      );
    }
  }
}

/**
 * Applies one verified payment event, exactly once. The event id is recorded in the same
 * transaction as its effects, so a crash mid-way lets the provider's retry run it again.
 */
export async function handlePaymentEvent(
  deps: OrderDeps,
  incoming: PaymentEvent,
): Promise<{ duplicate: boolean }> {
  const event = await resolveCheck(deps, incoming);
  if (!event) return { duplicate: false };
  const followUp: FollowUp = { mail: [] };
  try {
    await deps.db.$transaction(async (tx) => {
      await tx.processedWebhook.create({ data: { eventId: event.id } });
      if (event.type === "payment_succeeded") await onSucceeded(tx, event, followUp);
      else if (event.type === "payment_failed") await onFailed(tx, event);
      else if (event.type === "refunded") await onRefunded(tx, event, deps.payments.provider);
    });
  } catch (err) {
    if (isDuplicateEvent(err)) return { duplicate: true };
    throw err;
  }
  if (followUp.refund) await refundLatePayment(deps, followUp.refund);
  await sendFollowUpMail(deps, followUp.mail);
  return { duplicate: false };
}

async function refundLatePayment(deps: OrderDeps, due: NonNullable<FollowUp["refund"]>) {
  try {
    const refund = await deps.payments.refund({
      paymentId: due.paymentId,
      amountCents: due.amountCents,
      idempotencyKey: `late:${due.paymentId}`,
      reason: due.record ? "Paid after the order was cancelled" : "Payment amount mismatch",
    });
    if (!due.record) {
      await deps.db.orderEvent.create({
        data: {
          orderId: due.orderId,
          type: "mismatched_payment_refunded",
          message: `Refund ${refund.id}`,
        },
      });
      return;
    }
    await deps.db.$transaction(async (tx) => {
      await lockOrder(tx, due.orderId);
      await recordRefund(tx, due.orderId, {
        providerRefundId: refund.id,
        provider: deps.payments.provider,
        amountCents: due.amountCents,
        reason: "Paid after cancellation",
        actorId: SYSTEM_ACTOR,
      });
    });
  } catch (err) {
    // The event is already recorded, so the provider won't retry: flag it for staff.
    logger.error({ err: safeErrorFields(err), orderId: due.orderId }, "automatic refund failed");
    capturePaymentError(err, { step: "automatic_refund" });
    await deps.db.orderEvent.create({
      data: {
        orderId: due.orderId,
        type: "refund_failed",
        message: "Automatic refund failed; refund manually.",
      },
    });
  }
}

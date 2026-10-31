import { logger } from "../../lib/logger";
import { safeErrorFields } from "../../lib/safe-error";
import { paymentRefOf, type OrderDeps } from "../orders/orders.service";
import { handlePaymentEvent } from "./payment-events";

/** Give the webhook this long before asking the provider directly. */
const WEBHOOK_GRACE_MS = 5 * 60_000;
/** Recently cancelled, never-paid orders are re-checked for a late payment this far back. */
const CANCELLED_LOOKBACK_MS = 2 * 3_600_000;
const BATCH = 100;

export type ReconcileResult = { checked: number; recovered: number; failed: number };

async function candidates(deps: OrderDeps, now: Date) {
  return deps.db.order.findMany({
    where: {
      paymentMethod: "CARD",
      OR: [{ providerPaymentId: { not: null } }, { providerSessionId: { not: null } }],
      paidAt: null,
      AND: [
        {
          OR: [
            {
              status: "PENDING_PAYMENT",
              createdAt: { lt: new Date(now.getTime() - WEBHOOK_GRACE_MS) },
            },
            {
              status: "CANCELLED",
              refundedCents: 0,
              cancelledAt: { gte: new Date(now.getTime() - CANCELLED_LOOKBACK_MS) },
            },
          ],
        },
      ],
    },
    select: { id: true, providerPaymentId: true, providerSessionId: true },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
}

/**
 * Catches payments whose webhook never arrived: asks the provider about unpaid card orders
 * and books any succeeded payment through the same path as the webhook and the status check
 * (markOrderPaid), under a synthetic event id ("reconcile:<ref>") so it applies once. A
 * pending order becomes PAID; an already cancelled one is refunded automatically.
 * One provider failure doesn't stop the batch.
 */
export async function reconcilePayments(
  deps: OrderDeps,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const orders = await candidates(deps, now);
  let recovered = 0;
  let failed = 0;
  for (const order of orders) {
    const ref = paymentRefOf(order)!;
    try {
      const status = await deps.payments.getPaymentStatus(ref);
      if (status.status !== "succeeded" || !status.paymentId) continue;
      const { duplicate } = await handlePaymentEvent(deps, {
        id: `reconcile:${ref.sessionId ?? ref.paymentId}`,
        type: "payment_succeeded",
        ref,
        paymentId: status.paymentId,
        amountCents: status.amountCents,
      });
      if (!duplicate) recovered += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err: safeErrorFields(err), orderId: order.id },
        "payment reconciliation failed",
      );
    }
  }
  if (recovered > 0) logger.warn({ recovered }, "reconciled payments whose webhook was missed");
  return { checked: orders.length, recovered, failed };
}

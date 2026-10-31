import type { Db } from "../../lib/prisma";

const THREE_HOURS_MS = 3 * 3_600_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;

/** Order events that mean a payment needed (or still needs) a human. */
const PAYMENT_ISSUE_EVENTS = [
  "refund_failed",
  "payment_amount_mismatch",
  "payment_after_cancellation",
];

/** What the worker can see of one BullMQ queue (an interface so tests don't need Redis). */
export type QueueProbe = {
  name: string;
  counts(): Promise<Record<string, number>>;
  /** When the oldest waiting job was queued, or null if none are waiting. */
  oldestWaitingAt(): Promise<Date | null>;
};

export type OpsMetrics = {
  paidOrdersLast3h: number;
  /** Unpaid checkouts past their hold that the release job hasn't cancelled yet */
  overduePendingOrders: number;
  /** Payment problems recorded by the webhook handler (failed refunds, mismatches, late payments) */
  paymentIssuesLast15m: number;
  queues: Record<string, Record<string, number>>;
  oldestWaitingEmailSeconds: number | null;
};

/**
 * One snapshot for the `ops.metrics` log line. Webhook HTTP failures (bad signatures,
 * handler errors) are not stored, so count `payments.webhook` lines with an error outcome in
 * the log platform; this reports the payment problems the handler recorded on orders.
 */
export async function collectOpsMetrics(
  db: Db,
  probes: readonly QueueProbe[],
  now: Date = new Date(),
): Promise<OpsMetrics> {
  const [paidOrdersLast3h, overduePendingOrders, paymentIssuesLast15m] = await Promise.all([
    db.order.count({ where: { paidAt: { gte: new Date(now.getTime() - THREE_HOURS_MS) } } }),
    db.order.count({ where: { status: "PENDING_PAYMENT", reservationExpiresAt: { lt: now } } }),
    db.orderEvent.count({
      where: {
        type: { in: PAYMENT_ISSUE_EVENTS },
        createdAt: { gte: new Date(now.getTime() - FIFTEEN_MINUTES_MS) },
      },
    }),
  ]);
  const counted = await Promise.all(probes.map(async (p) => [p.name, await p.counts()] as const));
  const email = probes.find((p) => p.name === "email");
  const oldest = email ? await email.oldestWaitingAt() : null;
  return {
    paidOrdersLast3h,
    overduePendingOrders,
    paymentIssuesLast15m,
    queues: Object.fromEntries(counted),
    oldestWaitingEmailSeconds: oldest
      ? Math.round((now.getTime() - oldest.getTime()) / 1000)
      : null,
  };
}

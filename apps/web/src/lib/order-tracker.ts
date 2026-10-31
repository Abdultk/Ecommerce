import type { OrderDetail, OrderStatus } from "@hp/contracts";

export type TrackerStepKey =
  | "placed"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";
export type TrackerState = "done" | "current" | "upcoming";
export type TrackerStep = {
  key: TrackerStepKey;
  state: TrackerState;
  /** When it happened, from the order's own record. Null until it has happened. */
  at: string | null;
};

/** The parts of an order the tracker reads. */
export type TrackerInput = Pick<OrderDetail, "status" | "createdAt" | "paidAt" | "events">;

const PATH = ["placed", "paid", "processing", "shipped", "delivered"] as const;
type PathKey = (typeof PATH)[number];

/** The order status that marks each stage after "placed". */
const STAGE_STATUS: Readonly<Record<Exclude<PathKey, "placed">, OrderStatus>> = {
  paid: "PAID",
  processing: "PROCESSING",
  shipped: "SHIPPED",
  delivered: "DELIVERED",
};

const REACHED_BY_STATUS: Readonly<Partial<Record<OrderStatus, number>>> = {
  PENDING_PAYMENT: 0,
  PAID: 1,
  PROCESSING: 2,
  SHIPPED: 3,
  DELIVERED: 4,
};

/** The first time the order moved into `status`, or null if it never did. */
function whenReached(input: TrackerInput, status: OrderStatus): string | null {
  const event = input.events.find((e) => e.toStatus === status);
  return event?.createdAt ?? null;
}

function stageTime(input: TrackerInput, key: PathKey): string | null {
  if (key === "placed") return input.createdAt;
  if (key === "paid") return input.paidAt ?? whenReached(input, "PAID");
  return whenReached(input, STAGE_STATUS[key]);
}

/** Furthest stage a cancelled or refunded order actually got to, from its recorded events. */
function furthestReached(input: TrackerInput): number {
  let furthest = 0;
  PATH.forEach((key, index) => {
    if (index > 0 && stageTime(input, key) !== null) furthest = index;
  });
  return furthest;
}

/**
 * The order's progress as a list of stages. Everything shown comes from the order's own status
 * and recorded events: a stage that has not happened has no time, and nothing is estimated.
 * A cancelled or refunded order keeps the stages it reached and ends on that outcome.
 */
export function buildTracker(input: TrackerInput): TrackerStep[] {
  const outcome =
    input.status === "CANCELLED" ? "cancelled" : input.status === "REFUNDED" ? "refunded" : null;

  if (outcome) {
    const reached = PATH.slice(0, furthestReached(input) + 1).map(
      (key): TrackerStep => ({ key, state: "done", at: stageTime(input, key) }),
    );
    const outcomeStatus: OrderStatus = outcome === "cancelled" ? "CANCELLED" : "REFUNDED";
    return [...reached, { key: outcome, state: "current", at: whenReached(input, outcomeStatus) }];
  }

  const reached = REACHED_BY_STATUS[input.status] ?? 0;
  return PATH.map((key, index): TrackerStep => {
    if (index > reached) return { key, state: "upcoming", at: null };
    const isCurrent = index === reached && input.status !== "DELIVERED";
    return { key, state: isCurrent ? "current" : "done", at: stageTime(input, key) };
  });
}

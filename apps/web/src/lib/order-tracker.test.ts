import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@hp/contracts";
import { buildTracker, type TrackerInput } from "./order-tracker";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`;

const event = (toStatus: OrderStatus, day: number, id = `e-${toStatus}-${day}`) => ({
  id,
  type: "status_changed",
  fromStatus: null,
  toStatus,
  message: null,
  createdAt: at(day),
});

const order = (status: OrderStatus, events: TrackerInput["events"], paidDay?: number): TrackerInput => ({
  status,
  createdAt: at(1),
  paidAt: paidDay ? at(paidDay) : null,
  events,
});

const keysAndStates = (input: TrackerInput) =>
  buildTracker(input).map((step) => `${step.key}:${step.state}`);

describe("buildTracker", () => {
  it("shows an unpaid order as placed and everything after it as upcoming", () => {
    expect(keysAndStates(order("PENDING_PAYMENT", []))).toEqual([
      "placed:current",
      "paid:upcoming",
      "processing:upcoming",
      "shipped:upcoming",
      "delivered:upcoming",
    ]);
  });

  it("marks earlier stages done and the reached one current, with real timestamps", () => {
    const steps = buildTracker(
      order("PROCESSING", [event("PAID", 2), event("PROCESSING", 3)], 2),
    );

    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(steps.map((s) => s.at)).toEqual([at(1), at(2), at(3), null, null]);
  });

  it("never invents a time for a stage that has not happened", () => {
    const steps = buildTracker(order("PAID", [event("PAID", 2)], 2));

    expect(steps.filter((s) => s.state === "upcoming").every((s) => s.at === null)).toBe(true);
  });

  it("shows a delivered order with every stage done", () => {
    const steps = buildTracker(
      order(
        "DELIVERED",
        [event("PAID", 2), event("PROCESSING", 3), event("SHIPPED", 4), event("DELIVERED", 6)],
        2,
      ),
    );

    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(steps.at(-1)?.at).toBe(at(6));
  });

  it("keeps the stages a cancelled order reached and ends on cancelled", () => {
    expect(keysAndStates(order("CANCELLED", [event("PAID", 2), event("CANCELLED", 3)], 2))).toEqual([
      "placed:done",
      "paid:done",
      "cancelled:current",
    ]);
  });

  it("ends a cancelled unpaid order right after placed", () => {
    expect(keysAndStates(order("CANCELLED", [event("CANCELLED", 2)]))).toEqual([
      "placed:done",
      "cancelled:current",
    ]);
  });

  it("shows a refunded delivered order as the whole path followed by refunded", () => {
    const steps = buildTracker(
      order(
        "REFUNDED",
        [
          event("PAID", 2),
          event("PROCESSING", 3),
          event("SHIPPED", 4),
          event("DELIVERED", 6),
          event("REFUNDED", 9),
        ],
        2,
      ),
    );

    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      "placed:done",
      "paid:done",
      "processing:done",
      "shipped:done",
      "delivered:done",
      "refunded:current",
    ]);
    expect(steps.at(-1)?.at).toBe(at(9));
  });
});

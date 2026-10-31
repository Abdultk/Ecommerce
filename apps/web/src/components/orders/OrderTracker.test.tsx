import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@hp/contracts";
import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import { OrderTracker } from "./OrderTracker";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`;

type Order = Parameters<typeof OrderTracker>[0]["order"];

const order = (status: OrderStatus, trackingNumber: string | null = null): Order => ({
  status,
  createdAt: at(1),
  paidAt: status === "PENDING_PAYMENT" ? null : at(2),
  trackingNumber,
  carrier: null,
  estimatedDeliveryAt: null,
  events:
    status === "PENDING_PAYMENT"
      ? []
      : [
          { id: "e1", type: "s", fromStatus: null, toStatus: "PAID", message: null, createdAt: at(2) },
          { id: "e2", type: "s", fromStatus: null, toStatus: "PROCESSING", message: null, createdAt: at(3) },
        ],
});

const renderIn = (locale: "en" | "ar", value: Order) =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
      <OrderTracker order={value} />
    </NextIntlClientProvider>,
  );

describe("OrderTracker", () => {
  it("shows the stages in English with the current one marked", () => {
    renderIn("en", order("PROCESSING"));

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(within(steps[2]!).getByText("Being packed")).toBeTruthy();
    expect(steps[2]!.getAttribute("aria-current")).toBe("step");
    expect(steps[1]!.getAttribute("aria-current")).toBeNull();
  });

  it("shows the same stages in Arabic", () => {
    renderIn("ar", order("PROCESSING"));

    expect(screen.getByRole("heading", { name: "أين وصل طلبك" })).toBeTruthy();
    expect(screen.getByText("تم تأكيد الدفع")).toBeTruthy();
    expect(screen.getByText("تم شحن الطلب")).toBeTruthy();
  });

  it("announces each stage's state to screen readers, not only by colour", () => {
    renderIn("en", order("PROCESSING"));

    const steps = screen.getAllByRole("listitem");
    expect(steps[0]!.textContent).toContain("Completed");
    expect(steps[2]!.textContent).toContain("Current step");
    expect(steps[4]!.textContent).toContain("Not yet");
  });

  it("shows a time only for stages that have happened", () => {
    const { container } = renderIn("en", order("PROCESSING"));

    // placed, paid and processing happened; shipped and delivered have not.
    expect(container.querySelectorAll("time")).toHaveLength(3);
  });

  it("shows the Latin-digit date in Arabic, as Oman's shops do", () => {
    const { container } = renderIn("ar", order("PROCESSING"));

    const text = container.querySelector("time")?.textContent ?? "";
    expect(text).toMatch(/\d/);
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it("shows the tracking number once the order has one", () => {
    renderIn("en", order("SHIPPED", "OM123456"));

    expect(screen.getByText("OM123456")).toBeTruthy();
    expect(screen.queryByText(/appears here once the order ships/)).toBeNull();
  });

  it("says plainly that there is no tracking number yet, rather than inventing one", () => {
    renderIn("en", order("PROCESSING"));

    expect(screen.getByText(/appear here once the order ships/)).toBeTruthy();
  });

  it("shows the courier and the date staff expect it to arrive, only once shipped", () => {
    renderIn("en", {
      ...order("SHIPPED", "OM123456"),
      carrier: "Aramex",
      estimatedDeliveryAt: "2026-10-28T12:00:00.000Z",
    });

    expect(screen.getByText("Aramex")).toBeTruthy();
    expect(screen.getByText("Expected delivery")).toBeTruthy();
    expect(screen.getByText(/Oct 28, 2026/)).toBeTruthy();
  });

  it("drops the expected date once the order is delivered", () => {
    renderIn("en", {
      ...order("DELIVERED", "OM123456"),
      estimatedDeliveryAt: "2026-10-28T12:00:00.000Z",
    });

    expect(screen.queryByText("Expected delivery")).toBeNull();
  });

  it("ends a cancelled order on cancelled", () => {
    renderIn("en", order("CANCELLED"));

    const steps = screen.getAllByRole("listitem");
    expect(steps.at(-1)!.textContent).toContain("Cancelled");
    expect(steps.at(-1)!.getAttribute("aria-current")).toBe("step");
  });
});

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Totals } from "@hp/contracts";
import { renderWithProviders as render } from "@/test/render";
import { OrderSummary } from "./OrderSummary";

const totals = (shippingCents: number): Totals => ({
  subtotalCents: 4_800,
  discountCents: 0,
  shippingCents,
  taxCents: 0,
  totalCents: 4_800 + shippingCents,
});

describe("OrderSummary shipping row", () => {
  it("does not claim free shipping in the cart, where shipping is not yet calculated", () => {
    render(<OrderSummary totals={totals(0)} currency="OMR" />);

    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.getAllByText("Calculated at checkout")).toHaveLength(2);
  });

  it("shows Free once the totals are final and shipping is zero", () => {
    render(<OrderSummary totals={totals(0)} currency="OMR" final />);

    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("shows the amount whenever shipping is charged", () => {
    render(<OrderSummary totals={totals(1_500)} currency="OMR" final />);

    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.getByText(/1\.500/)).toBeTruthy();
  });
});

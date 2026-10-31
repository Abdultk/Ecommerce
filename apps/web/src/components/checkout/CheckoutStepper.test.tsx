import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CheckoutStepper } from "./CheckoutStepper";

describe("CheckoutStepper", () => {
  it("renders the 3 steps with the correct current active step", () => {
    const { rerender } = renderWithProviders(<CheckoutStepper currentStep="address" />);

    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("1Contact");

    rerender(<CheckoutStepper currentStep="shipping" />);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("2Shipping method");

    rerender(<CheckoutStepper currentStep="payment" />);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("3Payment");
  });
});

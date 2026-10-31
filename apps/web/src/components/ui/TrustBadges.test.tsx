import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { TrustBadges } from "./TrustBadges";
import { PaymentIcons } from "./PaymentIcons";

describe("TrustBadges", () => {
  it("renders secure checkout, shipping threshold, and returns badges", () => {
    renderWithProviders(<TrustBadges variant="inline" />);
    expect(screen.getByText(/secure checkout/i)).toBeInTheDocument();
    expect(screen.getByText(/free shipping/i)).toBeInTheDocument();
    expect(screen.getByText(/easy 14-day returns/i)).toBeInTheDocument();
  });

  it("renders in stacked variant layout", () => {
    const { container } = renderWithProviders(<TrustBadges variant="stacked" />);
    const ul = container.querySelector("ul");
    expect(ul).toHaveClass("flex-col");
  });
});

describe("PaymentIcons", () => {
  it("renders all payment badges", () => {
    renderWithProviders(<PaymentIcons />);
    expect(screen.getByRole("img", { name: "Visa" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Mastercard" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Apple Pay" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Amwal Pay" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Bank Transfer" })).toBeInTheDocument();
  });
});

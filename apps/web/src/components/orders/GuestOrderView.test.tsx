import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutIntent, type PaymentMethod } from "@hp/contracts";
import { createApiClient } from "@hp/api-client";
import { authStore } from "@/lib/auth-store";
import { navigationMock } from "@/test/navigation";
import { OMAN_ADDRESS } from "@/test/fixtures";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { addToMockCart, signInMock } from "@/test/session";
import { GuestOrderView } from "./GuestOrderView";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

const api = createApiClient(API_URL);

async function placeGuestOrder(paymentMethod: PaymentMethod): Promise<CheckoutIntent> {
  await addToMockCart("v_sample_04_1", 1);
  const { data } = await api.post(
    "/checkout/intent",
    {
      email: "guest@example.test",
      shippingAddress: OMAN_ADDRESS,
      shippingMethod: "express",
      paymentMethod,
    },
    CheckoutIntent,
  );
  return data;
}

async function placePaidGuestOrder(): Promise<CheckoutIntent> {
  const data = await placeGuestOrder("card");
  await api.post("/checkout/fake-confirm", { orderNumber: data.orderNumber });
  return data;
}

describe("GuestOrderView (email link /orders/:number#token=…)", () => {
  beforeEach(() => {
    authStore.clear();
    server.events.removeAllListeners();
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("reads the token from the fragment, strips it and posts it to /orders/lookup", async () => {
    const intent = await placePaidGuestOrder();
    const bodies: unknown[] = [];
    server.events.on("request:start", async ({ request }) => {
      if (request.url.endsWith("/orders/lookup")) bodies.push(await request.clone().json());
    });
    window.history.replaceState(
      null,
      "",
      `/orders/${intent.orderNumber}#token=${intent.lookupToken}`,
    );

    renderWithProviders(<GuestOrderView number={intent.orderNumber} />);

    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(intent.lookupToken);
    expect(await screen.findByRole("heading", { name: intent.orderNumber })).toBeInTheDocument();
    expect(screen.getByText(/chef's knife/i)).toBeInTheDocument();
    expect(bodies).toEqual([{ number: intent.orderNumber, token: intent.lookupToken }]);
    // Oman address: governorate by name, phone shown; paid by card.
    expect(screen.getByText(/Muscat, Muscat 112/).closest("address")).toHaveTextContent(
      "+96892345678",
    );
    expect(screen.getByText(/paid by card/i)).toBeInTheDocument();
  });

  it("shows an unpaid transfer order as awaiting bank transfer, with the details and deadline", async () => {
    const intent = await placeGuestOrder("bank_transfer");
    window.history.replaceState(
      null,
      "",
      `/orders/${intent.orderNumber}#token=${intent.lookupToken}`,
    );

    renderWithProviders(<GuestOrderView number={intent.orderNumber} />);

    const panel = await screen.findByRole("region", { name: /awaiting bank transfer/i });
    expect(screen.getAllByText("Awaiting bank transfer").length).toBeGreaterThan(0);
    expect(panel).toHaveTextContent(shownMoney(intent.totals.totalCents));
    expect(panel).toHaveTextContent(intent.orderNumber);
    expect(panel).toHaveTextContent(/GMT\+4/);
    expect(panel).toHaveTextContent(/held until/i);
    expect(screen.getByText("Payment: bank transfer")).toBeInTheDocument();
  });

  it("shows a not-found message for a wrong token", async () => {
    window.history.replaceState(null, "", `/orders/HP-2026-000001#token=${"z".repeat(32)}`);
    renderWithProviders(<GuestOrderView number="HP-2026-000001" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't find that order/i);
  });

  it("points signed-in customers to their account copy when there is no token", async () => {
    await signInMock();
    window.history.replaceState(null, "", "/orders/HP-2026-000001");
    renderWithProviders(<GuestOrderView number="HP-2026-000001" />);
    expect(await screen.findByRole("link", { name: /view it in your account/i })).toHaveAttribute(
      "href",
      "/account/orders/HP-2026-000001",
    );
  });

  it("asks signed-out visitors without a token to use their email link", async () => {
    window.history.replaceState(null, "", "/orders/HP-2026-000001");
    renderWithProviders(<GuestOrderView number="HP-2026-000001" />);
    expect(await screen.findByText(/open the link in your order email/i)).toBeInTheDocument();
  });
});

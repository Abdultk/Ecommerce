import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutIntent, ok, type OrderStatus } from "@hp/contracts";
import { createApiClient } from "@hp/api-client";
import { authStore } from "@/lib/auth-store";
import { stashPendingOrderForRedirect, takePendingOrder } from "@/lib/handoff";
import { MOCK_CARD_DECLINED_EMAIL } from "@/test/msw/checkout";
import { OMAN_ADDRESS } from "@/test/fixtures";
import { navigationMock } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { addToMockCart, signInMock } from "@/test/session";
import { CheckoutReturn } from "./CheckoutReturn";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

const FAST = { baseDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 };

/** A card checkout as the API leaves it before the shopper comes back from the payment page. */
async function placeCardOrder(email = "guest@example.test", bearer?: string) {
  const api = createApiClient(
    API_URL,
    bearer ? { get: () => bearer, refresh: async () => null } : undefined,
  );
  await addToMockCart("v_sample_04_1", 1);
  const { data } = await api.post(
    "/checkout/intent",
    { email, shippingAddress: OMAN_ADDRESS, shippingMethod: "standard", paymentMethod: "card" },
    CheckoutIntent,
  );
  return data;
}

const landOn = (search: string) =>
  window.history.replaceState(null, "", `/checkout/return${search}`);

describe("CheckoutReturn (/checkout/return?number=…)", () => {
  beforeEach(() => {
    authStore.clear();
    window.sessionStorage.clear();
    takePendingOrder("");
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("confirms a guest's payment using the token parked before the redirect", async () => {
    const intent = await placeCardOrder();
    stashPendingOrderForRedirect({
      orderNumber: intent.orderNumber,
      lookupToken: intent.lookupToken,
    });
    landOn(`?number=${intent.orderNumber}`);

    renderWithProviders(<CheckoutReturn poll={FAST} />);

    expect(await screen.findByRole("heading", { name: /payment received/i })).toBeInTheDocument();
    expect(screen.getByText(intent.orderNumber)).toBeInTheDocument();
    // Read once: the token never outlives this page.
    expect(window.sessionStorage.length).toBe(0);
  });

  it("checks a signed-in owner's order without any token and links to it", async () => {
    const session = await signInMock();
    const intent = await placeCardOrder("ada@example.test", session.accessToken);
    landOn(`?number=${intent.orderNumber}`);

    renderWithProviders(<CheckoutReturn poll={FAST} />);

    expect(await screen.findByRole("heading", { name: /payment received/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view your order/i })).toHaveAttribute(
      "href",
      `/account/orders/${intent.orderNumber}`,
    );
  });

  it("says the payment didn't go through and offers a retry", async () => {
    const intent = await placeCardOrder(MOCK_CARD_DECLINED_EMAIL);
    stashPendingOrderForRedirect({
      orderNumber: intent.orderNumber,
      lookupToken: intent.lookupToken,
    });
    landOn(`?number=${intent.orderNumber}`);

    renderWithProviders(<CheckoutReturn poll={FAST} />);

    expect(
      await screen.findByRole("heading", { name: /payment didn't go through/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /try again/i })).toHaveAttribute("href", "/checkout");
  });

  it("stays honest when the provider hasn't confirmed yet, and can check again", async () => {
    const user = userEvent.setup();
    const answers: OrderStatus[] = [
      "PENDING_PAYMENT",
      "PENDING_PAYMENT",
      "PENDING_PAYMENT",
      "PAID",
    ];
    let calls = 0;
    server.use(
      http.post(`${API_URL}/checkout/status`, () =>
        HttpResponse.json(ok({ status: answers[Math.min(calls++, answers.length - 1)] })),
      ),
    );
    stashPendingOrderForRedirect({ orderNumber: "HP-2026-001001", lookupToken: "t".repeat(32) });
    landOn("?number=HP-2026-001001");

    renderWithProviders(<CheckoutReturn poll={FAST} />);

    expect(await screen.findByRole("heading", { name: /still confirming/i })).toBeInTheDocument();
    expect(screen.getByText(/no need to pay again/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /check again/i }));
    expect(await screen.findByRole("heading", { name: /payment received/i })).toBeInTheDocument();
  });

  it("shows a polite progress message while checking", async () => {
    server.use(http.post(`${API_URL}/checkout/status`, () => new Promise<Response>(() => {})));
    stashPendingOrderForRedirect({ orderNumber: "HP-2026-001001", lookupToken: "t".repeat(32) });
    landOn("?number=HP-2026-001001");
    renderWithProviders(<CheckoutReturn poll={FAST} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/confirming your payment/i);
  });

  it("shows the API's message when the order can't be found", async () => {
    stashPendingOrderForRedirect({ orderNumber: "HP-2026-000777", lookupToken: "z".repeat(32) });
    landOn("?number=HP-2026-000777");
    renderWithProviders(<CheckoutReturn poll={FAST} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't find that order/i);
  });

  it("tells a guest without a token (another tab or device) to check their email", async () => {
    landOn("?number=HP-2026-001001");
    renderWithProviders(<CheckoutReturn poll={FAST} />);
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it("handles a missing or malformed order number, and scrubs any token from the URL", async () => {
    landOn(`?number=nope&token=${"s".repeat(32)}`);
    renderWithProviders(<CheckoutReturn poll={FAST} />);
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(window.location.href).not.toContain("s".repeat(32));
  });
});

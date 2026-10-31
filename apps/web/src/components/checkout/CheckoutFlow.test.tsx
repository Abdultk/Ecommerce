import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@hp/contracts";
import { authStore } from "@/lib/auth-store";
import { takeCartNotice, takePendingOrder } from "@/lib/handoff";
import { MOCK_STORE_CONFIG } from "@/test/msw/store";
import { navigationMock, routerSpies } from "@/test/navigation";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { addToMockCart, signInMock } from "@/test/session";
import { CheckoutFlow } from "./CheckoutFlow";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

type User = ReturnType<typeof userEvent.setup>;
const omr = (minor: number) => shownMoney(minor);
const navigate = vi.fn();

async function fillAddress(user: User, email = "ada@example.test") {
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Full name"), "Ada Cook");
  await user.selectOptions(screen.getByLabelText("Governorate"), "MA");
  await user.type(screen.getByLabelText("Wilayat"), "Bawshar");
  await user.type(screen.getByLabelText("Area and street"), "Al Khuwair, Way 3021");
  await user.type(screen.getByLabelText("Mobile phone"), "9123 4567");
  await user.click(screen.getByRole("button", { name: /continue to shipping/i }));
}

async function toPaymentChoice(user: User, email?: string) {
  await fillAddress(user, email);
  await user.click(await screen.findByRole("radio", { name: /express/i }));
  await user.click(screen.getByRole("button", { name: /continue to payment/i }));
}

async function placeOrder(user: User, method: RegExp = /card/i, email?: string) {
  await toPaymentChoice(user, email);
  await user.click(await screen.findByRole("radio", { name: method }));
  await user.click(screen.getByRole("button", { name: /place order/i }));
}

/** Records the Idempotency-Key and payment method of every intent request. */
function recordIntents(): { key: string | null; paymentMethod: unknown }[] {
  const seen: { key: string | null; paymentMethod: unknown }[] = [];
  server.events.on("request:start", async ({ request }) => {
    if (!request.url.endsWith("/checkout/intent")) return;
    const body = (await request.clone().json()) as { paymentMethod?: unknown };
    seen.push({ key: request.headers.get("idempotency-key"), paymentMethod: body.paymentMethod });
  });
  return seen;
}

const renderFlow = (options?: Parameters<typeof renderWithProviders>[2]) =>
  renderWithProviders(<CheckoutFlow navigate={navigate} />, undefined, options);

describe("CheckoutFlow", () => {
  beforeEach(async () => {
    authStore.clear();
    server.events.removeAllListeners();
    routerSpies.push.mockClear();
    navigate.mockClear();
    window.sessionStorage.clear();
    takePendingOrder("");
    takeCartNotice();
    await addToMockCart("v_sample_01_1", 1);
  });

  it("pays by card on the hosted payment page, priced in OMR", async () => {
    const user = userEvent.setup();
    const intents = recordIntents();
    renderFlow();

    await fillAddress(user);

    const shipping = await screen.findByRole("heading", { name: /shipping method/i });
    await waitFor(() => expect(shipping).toHaveFocus());
    // OMR 3.499 is under the free-shipping threshold, so standard is charged.
    // Intl's no-break space in the price is matched as any whitespace.
    expect(
      screen.getByRole("radio", {
        name: new RegExp(`standard.*${omr(2_000).replace(" ", "\\s")}`, "i"),
      }),
    ).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /express/i }));
    await user.click(screen.getByRole("button", { name: /continue to payment/i }));

    const methods = await screen.findByRole("group", { name: /payment method/i });
    expect(within(methods).getAllByRole("radio")).toHaveLength(2);
    expect(within(methods).getByRole("radio", { name: /card/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /place order/i }));

    const summary = screen.getByRole("complementary", { name: /order summary/i });
    // Server totals: 3499 + 5000 express + 5% VAT on goods (175) = 8674.
    expect(await within(summary).findByText(omr(8_674))).toBeInTheDocument();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `${window.location.origin}/checkout/return?number=HP-2026-001001`,
      ),
    );
    expect(intents).toEqual([{ key: expect.any(String), paymentMethod: "card" }]);
    // The lookup token waits in session storage for the return page, never in the URL.
    expect(String(navigate.mock.calls[0]?.[0])).not.toContain("token");
    expect(takePendingOrder("HP-2026-001001")?.lookupToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it("places a bank-transfer order and shows the transfer details instead of the steps", async () => {
    const user = userEvent.setup();
    const intents = recordIntents();
    renderFlow();

    await placeOrder(user, /bank transfer/i);

    const heading = await screen.findByRole("heading", { name: /order is placed/i });
    await waitFor(() => expect(heading).toHaveFocus());
    const panel = screen.getByRole("region", { name: /bank transfer details/i });
    expect(panel).toHaveTextContent(omr(8_674));
    expect(panel).toHaveTextContent("HP-2026-001001");
    expect(screen.queryByRole("heading", { name: /shipping method/i })).not.toBeInTheDocument();
    expect(intents).toEqual([{ key: expect.any(String), paymentMethod: "bank_transfer" }]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers only the payment methods the store has enabled", async () => {
    const user = userEvent.setup();
    renderFlow({ storeConfig: { ...MOCK_STORE_CONFIG, paymentMethods: ["bank_transfer"] } });
    await toPaymentChoice(user);
    const methods = await screen.findByRole("group", { name: /payment method/i });
    expect(within(methods).getAllByRole("radio")).toHaveLength(1);
    expect(within(methods).getByRole("radio", { name: /bank transfer/i })).toBeChecked();
  });

  it("shows field-level errors and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(await screen.findByRole("button", { name: /continue to shipping/i }));

    const email = screen.getByLabelText("Email");
    expect(email).toHaveFocus();
    expect(email).toHaveAccessibleDescription(/^Enter a valid email address./);
    expect(screen.getByLabelText("Governorate")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Mobile phone")).toHaveAccessibleDescription(
      /^Enter an Omani phone number/,
    );
  });

  it("prefills email and the default address when signed in", async () => {
    await signInMock();
    renderFlow();

    expect(await screen.findByDisplayValue("Al Khuwair, Way 3021")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.test");
    expect(screen.getByLabelText("Governorate")).toHaveValue("MA");
    expect(screen.getByLabelText("Mobile phone")).toHaveValue("+96891234567");
  });

  it("sends the shopper back to the cart with the API's message when stock ran out", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/checkout/intent`, () =>
        HttpResponse.json(
          fail("OUT_OF_STOCK", 'Only 0 left of Cast Iron Skillet 10".', {
            variantId: "v_sample_01_1",
            available: 0,
          }),
          { status: 409 },
        ),
      ),
    );
    renderFlow();

    await placeOrder(user);

    await waitFor(() => expect(routerSpies.push).toHaveBeenCalledWith("/cart"));
    expect(takeCartNotice()).toBe('Only 0 left of Cast Iron Skillet 10".');
  });

  it("retries a failed checkout with a fresh Idempotency-Key (no 409 dead end)", async () => {
    const user = userEvent.setup();
    const intents = recordIntents();
    server.use(http.post(`${API_URL}/checkout/intent`, () => HttpResponse.error(), { once: true }));
    renderFlow();

    await placeOrder(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach the server/i);
    await user.click(screen.getByRole("button", { name: /place order/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(intents).toHaveLength(2);
    expect(intents[0]?.key).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
    // The API answers a replayed key from a failed attempt with 409, so the retry must not reuse it.
    expect(intents[1]?.key).not.toBe(intents[0]?.key);
  });

  it("sends one intent request for a double-click", async () => {
    const user = userEvent.setup();
    const intents = recordIntents();
    renderFlow();
    await toPaymentChoice(user);
    await user.dblClick(await screen.findByRole("button", { name: /place order/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(intents).toHaveLength(1);
  });

  it("explains a payment method the store has just switched off", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/checkout/intent`, () =>
        HttpResponse.json(
          fail("PAYMENT_METHOD_UNAVAILABLE", "That payment method isn't available."),
          { status: 422 },
        ),
      ),
    );
    renderFlow();
    await placeOrder(user, /bank transfer/i);
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't available/i);
    expect(screen.getByRole("button", { name: /place order/i })).toBeEnabled();
  });

  it("lets the shopper switch away from a Stripe card form to another method", async () => {
    const user = userEvent.setup();
    const intents = recordIntents();
    server.use(
      http.post(
        `${API_URL}/checkout/intent`,
        () =>
          HttpResponse.json(
            ok({
              orderNumber: "HP-2026-001001",
              lookupToken: "a".repeat(32),
              currency: "OMR",
              totals: {
                subtotalCents: 3_499,
                discountCents: 0,
                shippingCents: 5_000,
                taxCents: 175,
                totalCents: 8_674,
              },
              payment: { kind: "client_secret", provider: "stripe", clientSecret: "pi_1_secret" },
            }),
            { status: 201 },
          ),
        { once: true },
      ),
    );
    renderFlow();
    await placeOrder(user);
    expect(await screen.findByText(/card payments aren't configured/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /use a different payment method/i }));
    await user.click(await screen.findByRole("radio", { name: /bank transfer/i }));
    await user.click(screen.getByRole("button", { name: /place order/i }));
    expect(await screen.findByRole("heading", { name: /order is placed/i })).toBeInTheDocument();
    expect(intents.map((i) => i.paymentMethod)).toEqual(["card", "bank_transfer"]);
    expect(intents[1]?.key).not.toBe(intents[0]?.key);
  });

  it("shows a coupon problem without leaving checkout", async () => {
    const user = userEvent.setup();
    renderFlow();
    await placeOrder(user, /card/i, "coupon-expired@example.test");
    expect(await screen.findByRole("alert")).toHaveTextContent(/coupon has expired/i);
    expect(routerSpies.push).not.toHaveBeenCalled();
  });

  it("shows the empty-cart state instead of the form", async () => {
    server.use(
      http.get(`${API_URL}/cart`, () =>
        HttpResponse.json(
          ok({
            id: "cart_empty",
            items: [],
            couponCode: null,
            currency: "OMR",
            totals: {
              subtotalCents: 0,
              discountCents: 0,
              shippingCents: 0,
              taxCents: 0,
              totalCents: 0,
            },
          }),
        ),
      ),
    );
    renderFlow();
    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});

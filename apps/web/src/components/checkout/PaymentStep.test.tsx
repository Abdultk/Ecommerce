import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CheckoutIntent, type CheckoutPayment } from "@hp/contracts";
import { takePendingOrder } from "@/lib/handoff";
import { MOCK_BANK } from "@/test/msw/store";
import { navigationMock } from "@/test/navigation";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { setupMockApi } from "@/test/server";
import { PaymentStep } from "./PaymentStep";

const stripe = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  loadStripe: vi.fn(() => Promise.resolve(null)),
  elementsProps: [] as unknown[],
}));

vi.mock("next/navigation", () => navigationMock());
// Only the side-effect-free entry may be used: the main entry injects Stripe.js on import,
// i.e. as soon as /checkout opens. Mocking just /pure makes any other import fail the test.
vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: stripe.loadStripe }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children, ...props }: { children: ReactNode }) => {
    stripe.elementsProps.push(props);
    return <div data-testid="elements">{children}</div>;
  },
  PaymentElement: () => <div>Card fields (Stripe iframe)</div>,
  useStripe: () => ({ confirmPayment: stripe.confirmPayment }),
  useElements: () => ({}),
}));
setupMockApi();

const NUMBER = "HP-2026-001001";
const TOKEN = "abcdef0123456789abcdef0123456789";
const TOTAL = 9_525;

const intent = (payment: CheckoutPayment): CheckoutIntent => ({
  orderNumber: NUMBER,
  lookupToken: TOKEN,
  currency: "OMR",
  totals: {
    subtotalCents: 3_499,
    discountCents: 0,
    shippingCents: 5_000,
    taxCents: 1_026,
    totalCents: TOTAL,
  },
  payment,
});

const stripeIntent = intent({
  kind: "client_secret",
  provider: "stripe",
  clientSecret: "pi_1_secret_2",
});
const AMWAL_URL = "https://api.example.com/api/v1/checkout/amwal-pay/abc.def";

beforeEach(() => window.sessionStorage.clear());

describe("PaymentStep with a hosted payment page (Amwal Pay)", () => {
  it("parks the lookup token for the return page and goes to the payment page", async () => {
    const navigate = vi.fn();
    renderWithProviders(
      <PaymentStep
        intent={intent({ kind: "redirect", provider: "amwal", redirectUrl: AMWAL_URL })}
        navigate={navigate}
      />,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(AMWAL_URL));
    expect(screen.getByRole("status")).toHaveTextContent(/secure payment page/i);
    expect(screen.getByRole("link", { name: /continue to payment/i })).toHaveAttribute(
      "href",
      AMWAL_URL,
    );
    // Never in the URL; read once by /checkout/return.
    expect(AMWAL_URL).not.toContain(TOKEN);
    expect(takePendingOrder(NUMBER)?.lookupToken).toBe(TOKEN);
    expect(stripe.loadStripe).not.toHaveBeenCalled();
  });

  it("refuses to send the shopper to an unsafe address", async () => {
    const navigate = vi.fn();
    renderWithProviders(
      <PaymentStep
        intent={intent({
          kind: "redirect",
          provider: "fake",
          redirectUrl: "http://pay.example.test/x",
        })}
        navigate={navigate}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      new RegExp(`couldn't open the payment page.*${NUMBER}`, "i"),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("PaymentStep with Stripe", () => {
  beforeEach(() => {
    stripe.confirmPayment.mockReset();
    stripe.elementsProps.length = 0;
  });

  it("mounts the Payment Element with the client secret and confirms with the return URL", async () => {
    const user = userEvent.setup();
    stripe.confirmPayment.mockResolvedValue({ error: { message: "Your card was declined." } });
    renderWithProviders(<PaymentStep intent={stripeIntent} publishableKey="pk_test_x" />);

    // The Stripe chunk is lazy-loaded with the payment step.
    expect(await screen.findByText(/card fields/i)).toBeInTheDocument();
    expect(stripe.loadStripe).toHaveBeenCalledWith("pk_test_x");
    expect(stripe.elementsProps[0]).toMatchObject({ options: { clientSecret: "pi_1_secret_2" } });

    await user.click(screen.getByRole("button", { name: "Pay now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your card was declined.");
    expect(stripe.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmParams: {
          return_url: `${window.location.origin}/checkout/return?number=${NUMBER}`,
        },
      }),
    );
    // The token only waits in storage while the redirect is in flight; a decline clears it.
    expect(window.sessionStorage.length).toBe(0);
  });

  it("stashes the lookup token, not the URL, while Stripe redirects", async () => {
    const user = userEvent.setup();
    let stashed: string | null = null;
    stripe.confirmPayment.mockImplementation(() => {
      stashed = window.sessionStorage.getItem("hp:pending-order");
      return new Promise(() => {}); // the page would be navigating away
    });
    renderWithProviders(<PaymentStep intent={stripeIntent} publishableKey="pk_test_x" />);
    await user.click(await screen.findByRole("button", { name: "Pay now" }));

    await waitFor(() => expect(stashed).toContain(TOKEN));
    expect(takePendingOrder(NUMBER)?.lookupToken).toBe(TOKEN);
  });

  it("falls back to a generic message when Stripe gives none", async () => {
    const user = userEvent.setup();
    stripe.confirmPayment.mockResolvedValue({ error: {} });
    renderWithProviders(<PaymentStep intent={stripeIntent} publishableKey="pk_test_x" />);
    await user.click(await screen.findByRole("button", { name: "Pay now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try another card/i);
  });

  it("explains a missing publishable key without loading Stripe", () => {
    stripe.loadStripe.mockClear();
    renderWithProviders(<PaymentStep intent={stripeIntent} publishableKey="" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/card payments aren't configured/i);
    expect(stripe.loadStripe).not.toHaveBeenCalled();
  });
});

describe("PaymentStep with a bank transfer", () => {
  const transfer = intent({
    kind: "bank_transfer",
    reference: NUMBER,
    amountCents: TOTAL,
    currency: "OMR",
    dueAt: "2026-10-14T09:00:00.000Z",
    bank: MOCK_BANK,
  });

  it("confirms the order and shows what to transfer, where to, and by when", async () => {
    renderWithProviders(<PaymentStep intent={transfer} email="ada@example.test" />);

    const heading = screen.getByRole("heading", { name: /order is placed/i });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(NUMBER, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/held until/i)).toHaveTextContent(/Oct 14.*1:00.*GMT\+4/);
    expect(screen.getByText(/confirm by email once/i)).toHaveTextContent("ada@example.test");

    const panel = screen.getByRole("region", { name: /bank transfer details/i });
    expect(panel).toHaveTextContent(shownMoney(TOTAL));
    expect(panel).toHaveTextContent("Bank Muscat");
    expect(screen.getByRole("button", { name: "Copy IBAN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy reference" })).toBeInTheDocument();
  });
});

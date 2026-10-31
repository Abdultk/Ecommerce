import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { fail } from "@hp/contracts";
import { makeCart, makeCartLine } from "@hp/test-utils";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { CartButton } from "./CartButton";
import { CartContents } from "./CartContents";
import { CartDrawer } from "./CartDrawer";

setupMockApi();

const filledCart = () =>
  makeCart(
    [
      makeCartLine({ productName: 'Cast Iron Skillet 10"', quantity: 2, stockAvailable: 3 }),
      makeCartLine({
        productSlug: "chefs-knife-8in",
        productName: "Chef's Knife 8\"",
        sku: "BR-CK8",
        unitPriceCents: 8900,
      }),
    ],
    {
      id: "cart_test",
      shippingCents: 799,
      discountCents: 500,
      couponCode: "WELCOME5",
      taxCents: 450,
    },
  );

describe("CartDrawer", () => {
  it("opens from the cart button as a modal dialog and focuses the close button", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <CartButton />
        <CartDrawer />
      </>,
    );

    await user.click(screen.getByRole("button", { name: /^cart,/i }));

    const dialog = screen.getByRole("dialog", { name: "Your cart" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close cart" })).toHaveFocus();
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("traps focus inside the dialog in both directions", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <CartButton />
        <CartDrawer />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /^cart,/i }));
    const close = screen.getByRole("button", { name: "Close cart" });
    const browse = await screen.findByRole("link", { name: /browse the shop/i });

    await user.tab();
    expect(browse).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(browse).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <CartButton />
        <CartDrawer />
      </>,
    );
    const trigger = screen.getByRole("button", { name: /^cart,/i });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes with the close button", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <CartButton />
        <CartDrawer />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /^cart,/i }));
    await user.click(screen.getByRole("button", { name: "Close cart" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CartContents", () => {
  it("lists lines and the server's totals", async () => {
    server.use(
      http.get(`${API_URL}/cart`, () =>
        HttpResponse.json({ success: true, data: filledCart(), error: null }),
      ),
    );
    renderWithProviders(<CartContents variant="page" />);

    const list = await screen.findByRole("list", { name: /items in your cart/i });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
    expect(screen.getByText("Discount (WELCOME5)")).toBeInTheDocument();
    expect(screen.getByText(`−${shownMoney(500)}`)).toBeInTheDocument();
    expect(screen.getByText(shownMoney(799))).toBeInTheDocument();
    expect(screen.getByText(shownMoney(450))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Checkout" })).toHaveAttribute("href", "/checkout");
    expect(screen.queryByRole("link", { name: "View cart" })).not.toBeInTheDocument();
  });

  it("offers View cart inside the drawer", async () => {
    server.use(
      http.get(`${API_URL}/cart`, () =>
        HttpResponse.json({ success: true, data: filledCart(), error: null }),
      ),
    );
    renderWithProviders(<CartContents variant="drawer" />);
    expect(await screen.findByRole("link", { name: "View cart" })).toHaveAttribute("href", "/cart");
  });

  it("shows an error with retry when the cart cannot load", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        `${API_URL}/cart`,
        () => HttpResponse.json(fail("INTERNAL", "The kitchen is closed."), { status: 500 }),
        {
          once: true,
        },
      ),
    );
    renderWithProviders(<CartContents variant="page" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The kitchen is closed.");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
  });
});

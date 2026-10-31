import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { fail } from "@hp/contracts";
import { sampleCatalog } from "@hp/test-utils";
import { CartButton } from "@/components/cart/CartButton";
import { shownMoney } from "@/test/money";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { ProductPurchase } from "./ProductPurchase";

setupMockApi();

const catalog = sampleCatalog();
const skillet = catalog[0]!; // 10in (24 in stock), 12in (8 in stock)
const dutchOven = catalog[1]!; // Cobalt in stock, Sage sold out

function renderPurchase(product = skillet) {
  return renderWithProviders(
    <>
      <CartButton />
      <ProductPurchase product={product} />
    </>,
  );
}

const cartCount = () =>
  within(screen.getByRole("button", { name: /^cart,/i })).getByTestId("cart-count");

describe("ProductPurchase / add to cart", () => {
  it("shows the selected variant's price and switches it with the picker", async () => {
    const user = userEvent.setup();
    renderPurchase();

    expect(screen.getByTestId("price")).toHaveTextContent(shownMoney(3_499));
    await user.click(screen.getByRole("radio", { name: /12 inch/ }));
    expect(screen.getByTestId("price")).toHaveTextContent(shownMoney(4_499));
  });

  it("shows the compare-at price and saving", () => {
    renderPurchase(dutchOven);
    expect(screen.getByText(shownMoney(25_900))).toBeInTheDocument();
    expect(screen.getByText(/save 15%/i)).toBeInTheDocument();
  });

  it("disables add to cart for a sold-out variant", async () => {
    const user = userEvent.setup();
    renderPurchase(dutchOven);

    await user.click(screen.getByRole("radio", { name: /Sage/ }));
    expect(screen.getByRole("button", { name: /sold out/i })).toBeDisabled();
  });

  it("updates the cart count optimistically, then keeps the server cart", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/cart/items`, async () => {
        await delay(150);
        return undefined; // fall through to the default mock handler
      }),
    );
    renderPurchase();
    await waitFor(() => expect(cartCount()).toHaveTextContent("0"));

    await user.click(screen.getByRole("button", { name: /add to cart/i }));

    // Optimistic: visible before the delayed response resolves.
    expect(cartCount()).toHaveTextContent("1");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/added/i));
    expect(cartCount()).toHaveTextContent("1");
  });

  it("rolls back and shows the OUT_OF_STOCK message when the server refuses", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/cart/items`, async () => {
        await delay(100);
        return HttpResponse.json(fail("OUT_OF_STOCK", 'Only 8 left of Cast Iron Skillet 10".'), {
          status: 409,
        });
      }),
    );
    renderPurchase();
    await waitFor(() => expect(cartCount()).toHaveTextContent("0"));

    await user.click(screen.getByRole("button", { name: /add to cart/i }));
    expect(cartCount()).toHaveTextContent("1");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Only 8 left of Cast Iron Skillet 10".',
    );
    expect(cartCount()).toHaveTextContent("0");
  });

  it("sends the chosen quantity", async () => {
    const user = userEvent.setup();
    renderPurchase();
    await waitFor(() => expect(cartCount()).toHaveTextContent("0"));

    await user.click(screen.getByRole("button", { name: /increase quantity/i }));
    await user.click(screen.getByRole("button", { name: /add to cart/i }));

    await waitFor(() => expect(cartCount()).toHaveTextContent("2"));
  });
});

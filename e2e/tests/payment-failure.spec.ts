import { test, expect, addProductToCart, fillCheckout, placeCardOrder } from "../support/fixtures";
import { adminOrderByNumber, createProduct } from "../support/api";
import { uniqueEmail } from "../support/data";

/**
 * Path 5 (adapted). The E2E API runs the fake card provider, whose hosted page has Pay and
 * Decline buttons (standing in for Amwal Pay's page). Declining must show the failure,
 * keep the cart, and never mark the order PAID.
 */
test.describe("Path 5: a declined payment shows an error and no order becomes PAID", () => {
  test("a declined payment leaves the order unpaid", async ({ page, api }) => {
    const product = await createProduct(api, { stock: 5 });
    await addProductToCart(page, product.slug);
    await fillCheckout(page, uniqueEmail("declined"));
    const number = await placeCardOrder(page);

    await page.getByRole("button", { name: "Decline", exact: true }).click();
    // A decline leaves the order open for a retry: the return page keeps checking and never
    // shows the success state.
    await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: /Payment received|Thanks for your order/ })).toHaveCount(0);

    const order = await adminOrderByNumber(api, number);
    expect(order.status).not.toBe("PAID");
  });
});

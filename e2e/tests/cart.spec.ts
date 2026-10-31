import { test, expect, addProductToCart, signInStorefront } from "../support/fixtures";
import { createProduct, registerCustomer } from "../support/api";
import { urls } from "../support/config";

test.describe("Path 3: guest cart → quantity → coupon → sign in → merge", () => {
  test("a guest cart keeps its lines, quantity and coupon pricing and merges on sign-in", async ({
    page,
    api,
  }) => {
    const pan = await createProduct(api, { stock: 20, priceCents: 5_900 });
    const board = await createProduct(api, {
      stock: 20,
      priceCents: 2_500,
      namePrefix: "E2E Board",
    });
    // The returning customer already has a board in their account cart.
    const customer = await registerCustomer(api, "merge");
    await api.ok("POST", "/cart/items", {
      token: customer.accessToken,
      body: { variantId: board.variantId, quantity: 1 },
    });

    // Guest: add, then change quantity on the cart page.
    await addProductToCart(page, pan.slug);
    await page.goto("/cart");
    const lines = page.getByRole("list", { name: "Items in your cart" });
    await expect(lines.getByText(pan.name)).toBeVisible();
    await lines.getByRole("button", { name: `Increase quantity of ${pan.name}` }).click();
    await expect(lines.getByRole("group", { name: `Quantity of ${pan.name}` })).toContainText("2");

    // DEFECT D-01: the storefront has no coupon field, so the code is applied through the
    // same guest-cart session (cookie) with the public API the UI would call.
    const applied = await page.request.post(`${urls.api}/cart/coupon`, {
      data: { code: "WELCOME10" },
    });
    expect(applied.status(), await applied.text()).toBe(200);
    await page.reload();
    const summary = page.getByRole("region", { name: "Order summary" });
    await expect(summary.getByText("Discount (WELCOME10)")).toBeVisible();

    // Sign in; the guest cart merges into the account cart. Checked in the header's cart
    // drawer (client-side), because a full page load shows the guest cart: defect D-03.
    await signInStorefront(page, customer.email, customer.password);
    await page.getByRole("button", { name: /^Cart, 3 items$/ }).click();
    const drawer = page.getByRole("dialog", { name: "Your cart" });
    await expect(drawer.getByText(pan.name)).toBeVisible();
    await expect(drawer.getByText(board.name)).toBeVisible();
    await expect(drawer.getByRole("group", { name: `Quantity of ${pan.name}` })).toContainText("2");
  });
});

test.describe("D-03 regression", () => {
  test("a signed-in customer's cart survives a full page load", async ({ page, api }) => {
    const product = await createProduct(api, { stock: 5 });
    const customer = await registerCustomer(api, "reload");
    await api.ok("POST", "/cart/items", {
      token: customer.accessToken,
      body: { variantId: product.variantId, quantity: 1 },
    });
    await signInStorefront(page, customer.email, customer.password);
    await page.goto("/cart");
    await expect(
      page.getByRole("list", { name: "Items in your cart" }).getByText(product.name),
    ).toBeVisible();
  });
});

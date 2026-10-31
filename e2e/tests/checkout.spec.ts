import {
  test,
  expect,
  addProductToCart,
  fillCheckout,
  newShopperContext,
  payWithFakeProvider,
  signInStorefront,
} from "../support/fixtures";
import { adminOrderByNumber, createProduct, registerCustomer } from "../support/api";
import { urls } from "../support/config";
import { uniqueEmail } from "../support/data";
import { linkTo, waitForEmail } from "../support/mailpit";

test.describe("Path 4: checkout → confirmation → account history", () => {
  test("a signed-in customer pays and finds the order in their history", async ({ page, api }) => {
    const product = await createProduct(api, { stock: 5 });
    const customer = await registerCustomer(api, "checkout");
    await signInStorefront(page, customer.email, customer.password);

    await addProductToCart(page, product.slug);
    await fillCheckout(page, customer.email);
    const number = await payWithFakeProvider(page);

    await page.goto("/account/orders");
    await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(number) }).click();
    await expect(page.getByRole("heading", { level: 1, name: number })).toBeVisible();
    await expect(page.getByText(product.name)).toBeVisible();
    await expect(page.getByText(/^paid$/i).first()).toBeVisible();

    expect((await adminOrderByNumber(api, number)).status).toBe("PAID");
  });
});

test.describe("Guest checkout and emailed order lookup", () => {
  test("a guest pays with the fake provider and opens the order from the email link", async ({
    page,
    api,
    browser,
  }) => {
    const product = await createProduct(api, { stock: 5 });
    const email = uniqueEmail("guest");

    await addProductToCart(page, product.slug);
    await fillCheckout(page, email);
    const number = await payWithFakeProvider(page);
    await expect(page.getByText(/A receipt is on its way/)).toBeVisible();

    const mail = await waitForEmail(email, new RegExp(`receipt for order ${number}`));
    const link = linkTo(mail, urls.web);
    expect(link).toContain(`/orders/${number}#token=`);

    // Opened on another device: only the emailed link proves who the guest is.
    const other = await newShopperContext(browser);
    const otherPage = await other.newPage();
    await otherPage.goto(link);
    await expect(otherPage.getByRole("heading", { level: 1, name: number })).toBeVisible();
    await expect(otherPage.getByText(product.name)).toBeVisible();
    await expect(otherPage).not.toHaveURL(/token=/);

    // Without the token the order stays private.
    await otherPage.goto(`/orders/${number}`);
    await expect(otherPage.getByText(product.name)).toHaveCount(0);
    await other.close();
  });
});

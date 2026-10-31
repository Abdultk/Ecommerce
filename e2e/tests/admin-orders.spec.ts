import type { Page } from "@playwright/test";
import {
  test,
  expect,
  newShopperContext,
  signInAdmin,
  signInStorefront,
} from "../support/fixtures";
import {
  adminOrder,
  createAdmin,
  createProduct,
  placePaidOrder,
  registerCustomer,
} from "../support/api";
import { urls } from "../support/config";
import { uniqueSuffix } from "../support/data";
import { waitForEmail } from "../support/mailpit";

async function changeStatus(page: Page, button: string, tracking?: string): Promise<void> {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog");
  if (tracking) await dialog.getByLabel("Tracking number").fill(tracking);
  await dialog.getByRole("button", { name: "Update status" }).click();
  await expect(dialog).toHaveCount(0);
}

async function confirmTyped(page: Page, number: string, confirm: string): Promise<void> {
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel(/to confirm/).fill(number);
  await dialog.getByRole("button", { name: confirm }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("Path 8: shipping, and STAFF can't refund", () => {
  test("admin ships with tracking; the customer sees it; STAFF has no refund", async ({
    page,
    api,
    browser,
  }) => {
    // Three accounts (customer, ADMIN, STAFF) each hash a password with argon2id.
    test.setTimeout(180_000);
    const product = await createProduct(api, { stock: 3 });
    const customer = await registerCustomer(api, "shipped");
    const order = await placePaidOrder(api, customer, product.variantId);
    const tracking = `1Z${uniqueSuffix().toUpperCase()}`;

    const admin = await createAdmin(api, "ADMIN");
    await signInAdmin(page, admin);
    await page.goto(`${urls.admin}/orders/${order.id}`);
    await expect(page.getByRole("heading", { level: 1, name: order.number })).toBeVisible();
    await changeStatus(page, "Mark as processing");
    await changeStatus(page, "Mark as shipped", tracking);
    await expect(page.getByText("Shipped", { exact: true }).first()).toBeVisible();

    // Customer: email + account order page show the tracking number.
    const mail = await waitForEmail(customer.email, new RegExp(`${order.number} has shipped`));
    expect(mail.text).toContain(tracking);
    const shopper = await newShopperContext(browser);
    const shopperPage = await shopper.newPage();
    await signInStorefront(shopperPage, customer.email, customer.password);
    await shopperPage.goto(`/account/orders/${order.number}`);
    await expect(shopperPage.getByText(/^shipped$/i).first()).toBeVisible();
    await expect(shopperPage.getByText(tracking)).toBeVisible();
    await shopper.close();

    // STAFF: no Refund button, and the API refuses a refund outright.
    const staff = await createAdmin(api, "STAFF");
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await signInAdmin(staffPage, staff);
    await staffPage.goto(`${urls.admin}/orders/${order.id}`);
    await expect(staffPage.getByRole("heading", { level: 1, name: order.number })).toBeVisible();
    await expect(staffPage.getByRole("button", { name: "Refund" })).toHaveCount(0);
    await staffContext.close();

    const refund = await api.call("POST", `/admin/orders/${order.id}/refund`, {
      token: staff.accessToken,
      body: { amountCents: 100 },
    });
    expect(refund.status).toBe(403);
    expect((await adminOrder(api, order.id)).order.status).toBe("SHIPPED");
  });
});

test.describe("Refund and cancel", () => {
  test("an admin refunds a paid order in full", async ({ page, api }) => {
    const product = await createProduct(api, { stock: 3 });
    const customer = await registerCustomer(api, "refund");
    const order = await placePaidOrder(api, customer, product.variantId);
    const admin = await createAdmin(api, "ADMIN");

    await signInAdmin(page, admin);
    await page.goto(`${urls.admin}/orders/${order.id}`);
    await page.getByRole("button", { name: "Refund" }).click();
    await confirmTyped(page, order.number, "Refund");

    await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();
    expect((await adminOrder(api, order.id)).order.status).toBe("REFUNDED");
  });

  test("an admin cancels a paid order and the customer is told", async ({ page, api }) => {
    const product = await createProduct(api, { stock: 3 });
    const customer = await registerCustomer(api, "cancel");
    const order = await placePaidOrder(api, customer, product.variantId);
    const admin = await createAdmin(api, "ADMIN");

    await signInAdmin(page, admin);
    await page.goto(`${urls.admin}/orders/${order.id}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await confirmTyped(page, order.number, "Cancel order");

    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    expect((await adminOrder(api, order.id)).order.status).toBe("CANCELLED");
    await waitForEmail(customer.email, new RegExp(`${order.number} was cancelled`));
  });
});

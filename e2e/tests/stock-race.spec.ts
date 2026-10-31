import {
  test,
  expect,
  alertMessage,
  addProductToCart,
  fillCheckout,
  newShopperContext,
  
} from "../support/fixtures";
import { createProduct } from "../support/api";
import { uniqueEmail } from "../support/data";
import type { Page } from "@playwright/test";

const CONTINUE = "Continue to payment";

async function readyToReserve(page: Page, slug: string): Promise<void> {
  await addProductToCart(page, slug);
  await page.goto("/checkout");
  await page.getByLabel("Email").fill(uniqueEmail("race"));
  await page.getByLabel("Full name").fill("Ada Cook");
  await page.getByLabel("Governorate").selectOption({ label: "Muscat" });
  await page.getByLabel("Wilayat").fill("Seeb");
  await page.getByLabel("Area and street").fill("Al Khuwair, Way 1234");
  await page.getByLabel("Mobile phone").fill("+96891234567");
  await page.getByRole("button", { name: "Continue to shipping" }).click();
  await expect(page.getByRole("button", { name: CONTINUE })).toBeEnabled();
  await page.getByRole("button", { name: CONTINUE }).click();
  await page.getByRole("radio", { name: /Card/ }).check();
  await expect(page.getByRole("button", { name: "Place order" })).toBeEnabled();
}

test.describe("Path 6: out-of-stock race", () => {
  test("two shoppers buy the last unit; exactly one succeeds", async ({ browser, api }) => {
    const product = await createProduct(api, { stock: 1 });
    const contexts = await Promise.all([newShopperContext(browser), newShopperContext(browser)]);
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((p) => readyToReserve(p, product.slug)));

    // Both place the order, and so reserve stock, at the same moment.
    await Promise.all(pages.map((p) => p.getByRole("button", { name: "Place order" }).click()));

    // The winner lands on the provider's page; the loser stays on checkout with an error.
    const payButton = (p: Page) => p.getByRole("button", { name: "Pay", exact: true });
    const outcome = async (p: Page) => {
      await expect(payButton(p).or(alertMessage(p)).first()).toBeVisible();
      return (await payButton(p).isVisible()) ? "reserved" : "refused";
    };
    const results = await Promise.all(pages.map(outcome));
    expect([...results].sort()).toEqual(["refused", "reserved"]);

    const loser = pages[results.indexOf("refused")]!;
    await expect(alertMessage(loser)).toContainText(/stock|available|left/i);

    const winner = pages[results.indexOf("reserved")]!;
    await payButton(winner).click();
    await expect(winner.getByRole("heading", { name: /Payment received|Thanks for your order/ })).toBeVisible({
      timeout: 30_000,
    });

    // Stock is gone. (The PDP itself is ISR-cached for 60 s, so it may still say "1 left".)
    const detail = await api.ok<{ variants: { id: string; stockAvailable: number }[] }>(
      "GET",
      `/products/${product.slug}`,
    );
    expect(detail.variants.find((v) => v.id === product.variantId)?.stockAvailable).toBe(0);
    await Promise.all(contexts.map((c) => c.close()));
  });
});

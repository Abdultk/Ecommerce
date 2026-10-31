import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Api, type AdminAccount } from "./api";
import { urls } from "./config";
import { ADDRESS } from "./data";
import { clientIpHeaders } from "./net";
import { totpCode } from "./totp";

type Fixtures = { api: Api };

/**
 * Every test gets its own client IP (see net.ts) and an API client that presents another
 * one, so per-IP rate limits and guest carts never leak between tests.
 */
export const test = base.extend<Fixtures>({
  extraHTTPHeaders: async ({}, use) => {
    await use(clientIpHeaders());
  },
  api: async ({}, use) => {
    const api = await Api.create();
    await use(api);
    await api.dispose();
  },
});

export { expect };

/** A second, fully separate shopper (own cookies, own IP). */
export async function newShopperContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: urls.web, extraHTTPHeaders: clientIpHeaders() });
}

// ---------- Storefront flows ----------

export async function addProductToCart(page: Page, slug: string, quantity = 1): Promise<void> {
  await page.goto(`/p/${slug}`);
  for (let i = 1; i < quantity; i++) {
    await page.getByRole("button", { name: "Increase quantity" }).click();
  }
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Added \d+ ×/ })).toBeVisible();
}

/**
 * Fills step 1, accepts the default shipping method and opens the payment step. Goes to
 * checkout the way a shopper does: the open cart drawer's Checkout link (client-side), or
 * a direct visit when the drawer isn't open.
 */
export async function fillCheckout(page: Page, email: string | null): Promise<void> {
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  if (await drawer.isVisible()) {
    await drawer.getByRole("link", { name: "Checkout" }).click();
  } else {
    await page.goto("/checkout");
  }
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  if (email !== null) await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill(ADDRESS.fullName);
  await page.getByLabel("Governorate").selectOption({ label: ADDRESS.governorateName });
  await page.getByLabel("Wilayat").fill(ADDRESS.city);
  await page.getByLabel("Area and street").fill(ADDRESS.line1);
  await page.getByLabel("Mobile phone").fill(ADDRESS.phone);
  await page.getByRole("button", { name: "Continue to shipping" }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
}

/**
 * Places the order with a card and pays on the fake provider's hosted page (the stand-in for
 * Amwal Pay in the E2E API). Returns the confirmed order number.
 */
export async function payWithFakeProvider(page: Page): Promise<string> {
  const number = await placeCardOrder(page);
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Payment received|Thanks for your order/ })).toBeVisible({
    timeout: 30_000,
  });
  return number;
}

/** Chooses card, places the order, and lands on the provider's page; returns the order number. */
export async function placeCardOrder(page: Page): Promise<string> {
  const intent = page.waitForResponse(
    (r) => r.url().endsWith("/checkout/intent") && r.request().method() === "POST",
  );
  await page.getByRole("radio", { name: /Card/ }).check();
  await page.getByRole("button", { name: "Place order" }).click();
  const { data } = (await (await intent).json()) as { data: { orderNumber: string } };
  await expect(page.getByRole("button", { name: "Pay", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return data.orderNumber;
}

export async function signInStorefront(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

// ---------- Admin flows ----------

/** Password + TOTP sign-in on the admin app; returns the account with its spent step. */
export async function signInAdmin(page: Page, account: AdminAccount): Promise<AdminAccount> {
  await page.goto(`${urls.admin}/login`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Continue" }).click();
  const { code, step } = totpCode(account.secret, account.lastStep);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  return { ...account, lastStep: step };
}

/** The page's alert(s), excluding Next's always-present route announcer (also role=alert). */
export const alertMessage = (page: Page) =>
  page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));

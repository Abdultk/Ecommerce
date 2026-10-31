import { test, expect, alertMessage, signInStorefront } from "../support/fixtures";
import { randomPassword, uniqueEmail } from "../support/data";
import { linkTo, waitForEmail } from "../support/mailpit";
import { urls } from "../support/config";

async function register(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/register");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Cook");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  // Registering never signs in: the form is replaced by a "check your email" notice.
  await expect(page.getByRole("status")).toContainText(email);
}

test.describe("Path 1: register → verify email → sign in", () => {
  test("a new customer verifies their email from Mailpit and signs in", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("register");
    const password = randomPassword();
    await register(page, email, password);

    const mail = await waitForEmail(email, /Confirm your email/);
    await page.goto(linkTo(mail, urls.web));
    await expect(page.getByText("Thanks, your email is verified.")).toBeVisible();
    // The one-time token is stripped from the address bar once read.
    await expect(page).not.toHaveURL(/token=/);

    // A brand-new browser (no refresh cookie) signs in with the same credentials.
    const fresh = await browser.newContext({ baseURL: urls.web });
    const freshPage = await fresh.newPage();
    await signInStorefront(freshPage, email, password);
    await freshPage.goto("/account");
    await expect(freshPage.getByRole("navigation", { name: "Account" })).toContainText("Hi, Ada");
    await fresh.close();
  });

  test("a verification link works only once", async ({ page }) => {
    const email = uniqueEmail("verify-once");
    await register(page, email, randomPassword());
    const link = linkTo(await waitForEmail(email, /Confirm your email/), urls.web);
    await page.goto(link);
    await expect(page.getByText("Thanks, your email is verified.")).toBeVisible();
    // A new tab: re-opening the same URL in place would only be a same-document hash change.
    const again = await page.context().newPage();
    await again.goto(link);
    await expect(alertMessage(again)).toContainText(/expired or was already used/);
  });
});

test.describe("Password reset via Mailpit", () => {
  test("a customer resets a forgotten password and signs in with the new one", async ({ page }) => {
    const email = uniqueEmail("reset");
    const oldPassword = randomPassword();
    const newPassword = randomPassword();
    await register(page, email, oldPassword);
    await page.context().clearCookies();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const mail = await waitForEmail(email, /Reset your .* password/);
    await page.goto(linkTo(mail, urls.web));
    await expect(page).not.toHaveURL(/token=/);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(oldPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alertMessage(page)).toBeVisible();

    await signInStorefront(page, email, newPassword);
  });
});

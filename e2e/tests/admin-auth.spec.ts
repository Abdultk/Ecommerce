import { test, expect, alertMessage, signInAdmin } from "../support/fixtures";
import { createAdmin, inviteStaff } from "../support/api";
import { urls } from "../support/config";
import { randomPassword } from "../support/data";
import { acceptedCodes, totpCode } from "../support/totp";

test.describe("Path 7a: admin password + TOTP sign-in", () => {
  test("an invited admin enrolls TOTP in the UI, then signs in with password and code", async ({
    page,
    api,
  }) => {
    const { email, inviteLink } = await inviteStaff(api, "ADMIN");
    const password = randomPassword();

    await page.goto(inviteLink);
    await expect(page).not.toHaveURL(/token=/);
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Set password" }).click();

    // Enrollment: QR code plus the key typed by hand into an authenticator.
    const enroll = page.getByRole("region", { name: "Set up your authenticator" });
    // Setting the password hashes it with argon2id, which is slow on a busy machine.
    await expect(enroll.getByRole("img", { name: /QR code/ })).toBeVisible({ timeout: 30_000 });
    const secret = (await enroll.locator("code").textContent())?.replace(/\s/g, "") ?? "";
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    const first = totpCode(secret, null);
    await page.getByLabel("6-digit code").fill(first.code);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await signInAdmin(page, {
      email,
      password,
      role: "ADMIN",
      secret,
      lastStep: first.step,
      accessToken: "",
    });
  });

  test("a wrong code is rejected with a clear message", async ({ page, api }) => {
    const admin = await createAdmin(api, "ADMIN");
    await page.goto(`${urls.admin}/login`);
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Continue" }).click();

    const valid = acceptedCodes(admin.secret);
    const wrong = ["000000", "111111", "222222", "333333"].find((c) => !valid.has(c))!;
    await page.getByLabel("6-digit code").fill(wrong);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(alertMessage(page)).toHaveText(
      "That code didn't work. Check your authenticator app.",
    );
    await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0);
  });

  test("a wrong password never reaches the code step", async ({ page, api }) => {
    const admin = await createAdmin(api, "STAFF");
    await page.goto(`${urls.admin}/login`);
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill(`${admin.password}x`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(alertMessage(page)).toHaveText("Email or password is incorrect.");
    await expect(page.getByLabel("6-digit code")).toHaveCount(0);
  });
});

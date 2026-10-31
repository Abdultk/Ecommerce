import { test, expect, addProductToCart, signInAdmin } from "../support/fixtures";
import { createAdmin, createProduct } from "../support/api";
import { expectNoSeriousA11yViolations } from "../support/axe";
import { urls } from "../support/config";

// Blueprint 8.1: home, listing, PDP, cart, checkout and admin login, plus a few more.
test.describe("axe: storefront", () => {
  const staticPages = [
    { label: "home", path: "/" },
    { label: "listing", path: "/shop" },
    { label: "search", path: "/shop?q=skillet" },
    { label: "pdp", path: "/p/cast-iron-skillet-10in" },
    { label: "login", path: "/login" },
    { label: "register", path: "/register" },
  ];
  for (const { label, path } of staticPages) {
    test(`${label} (${path})`, async ({ page }, testInfo) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expectNoSeriousA11yViolations(page, testInfo, label);
    });
  }

  test("cart and checkout with an item", async ({ page, api }, testInfo) => {
    const product = await createProduct(api, { stock: 5 });
    await addProductToCart(page, product.slug);
    await expectNoSeriousA11yViolations(page, testInfo, "cart-drawer");

    await page.goto("/cart");
    await expect(page.getByRole("list", { name: "Items in your cart" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, "cart");

    await page.goto("/checkout");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, "checkout");
  });
});

test.describe("axe: admin", () => {
  test("login", async ({ page }, testInfo) => {
    await page.goto(`${urls.admin}/login`);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, "admin-login");
  });

  test("dashboard pages", async ({ page, api }, testInfo) => {
    const admin = await createAdmin(api, "ADMIN");
    await signInAdmin(page, admin);
    await expectNoSeriousA11yViolations(page, testInfo, "admin-overview");
    for (const section of ["products", "orders", "products/new", "analytics", "reports"]) {
      await page.goto(`${urls.admin}/${section}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoSeriousA11yViolations(page, testInfo, `admin-${section.replace("/", "-")}`);
    }
  });
});

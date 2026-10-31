import { test, expect, signInAdmin } from "../support/fixtures";
import { categoryBySlug, createAdmin } from "../support/api";
import { urls } from "../support/config";
import { uniqueSuffix } from "../support/data";
import { TINY_PNG, stubImageCdn } from "../support/images";

test.describe("Path 7b: admin creates a product with an image → storefront", () => {
  test("a new ACTIVE product with an image is live on the storefront", async ({ page, api }) => {
    const admin = await createAdmin(api, "ADMIN");
    const category = await categoryBySlug(api);
    const suffix = uniqueSuffix();
    const name = `E2E Wok ${suffix}`;
    const sku = `E2E-WOK-${suffix.toUpperCase()}`;
    const alt = `Carbon steel wok ${suffix} on a gas burner`;

    const uploads = await stubImageCdn(page);
    await signInAdmin(page, admin);
    await page.goto(`${urls.admin}/products/new`);

    await page.getByLabel("Product name").fill(name);
    await expect(page.getByLabel("Slug")).toHaveValue(/e2e-wok/);
    const slug = await page.getByLabel("Slug").inputValue();
    await page.getByLabel("Brand").fill("Hearth Test Co");
    await page.getByLabel("Category").selectOption(category.id);
    await page.getByLabel("Status").selectOption({ label: "Active" });
    await page.getByLabel("Description").fill("A wok seasoned for E2E tests.");

    await page.getByLabel("SKU").fill(sku);
    await page.getByLabel("Name", { exact: true }).fill("14 inch");
    await page.getByLabel("Price (OMR)").fill("64.500");
    await page.getByLabel("Initial stock").fill("7");

    await page.getByLabel("Add images").setInputFiles({
      name: "wok.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await page.getByLabel(/Alt text, image 1/).fill(alt);
    expect(uploads).toHaveLength(1);

    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page).toHaveURL(/\/products\/[^/]+$/);

    // Storefront: the PDP renders it (price, stock, image with its alt text).
    const shop = await page.context().newPage();
    await shop.goto(`${urls.web}/p/${slug}`);
    await expect(shop.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(shop.getByText("OMR 64.500").first()).toBeVisible();
    await expect(shop.getByRole("img", { name: alt }).first()).toBeVisible();
    await expect(shop.getByRole("button", { name: "Add to cart" })).toBeEnabled();
  });
});

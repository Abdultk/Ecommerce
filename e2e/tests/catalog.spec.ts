import { test, expect } from "../support/fixtures";

test.describe("Path 2: typo-tolerant search and filters", () => {
  test('searching "skilet" finds the Cast Iron Skillet', async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Search products" });
    await search.fill("skilet");
    await search.press("Enter");

    await expect(page).toHaveURL(/\/shop\?q=skilet/);
    await expect(page.getByRole("heading", { name: /for “skilet”/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Cast Iron Skillet/ }).first()).toBeVisible();
  });

  test("filtering by material and price narrows the listing", async ({ page }) => {
    await page.goto("/shop");
    const filters = page.getByRole("complementary", { name: "Filters" });
    const products = page.getByRole("region", { name: /product|result/i }).or(page.locator("main"));

    // The facet navigates (the URL is the state), so click and wait for the new URL.
    const castIron = filters.getByRole("checkbox", { name: /^Cast iron\b/ });
    await castIron.click();
    await expect(page).toHaveURL(/material=/);
    await expect(castIron).toBeChecked();
    await expect(products.getByRole("link", { name: /Cast Iron Skillet/ }).first()).toBeVisible();
    await expect(products.getByRole("link", { name: /Dutch Oven/ })).toHaveCount(0);
    await expect(products.getByRole("link", { name: /Chef's Knife/ })).toHaveCount(0);

    await filters.getByLabel("Min price (OMR)").fill("1");
    await filters.getByLabel("Max price (OMR)").fill("500");
    await filters.getByRole("button", { name: "Apply price" }).click();
    await expect(page).toHaveURL(/minPrice=1000/);
    await expect(page).toHaveURL(/maxPrice=500000/);
    await expect(products.getByRole("link", { name: /Cast Iron Skillet/ }).first()).toBeVisible();

    // A price window with nothing in it empties the grid (and says so).
    await filters.getByLabel("Min price (OMR)").fill("0.001");
    await filters.getByLabel("Max price (OMR)").fill("0.002");
    await filters.getByRole("button", { name: "Apply price" }).click();
    await expect(products.getByRole("link", { name: /Cast Iron Skillet/ })).toHaveCount(0);
  });
});

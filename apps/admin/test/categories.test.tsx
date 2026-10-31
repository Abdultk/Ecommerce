import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { CategoryManager } from "@/components/categories/CategoryManager";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

function capture(method: "post" | "patch", path: string) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

const item = (name: string) => screen.getByRole("listitem", { name });

async function renderManager() {
  renderWithProviders(<CategoryManager />, { role: "STAFF" });
  await screen.findByRole("listitem", { name: "Cookware" });
  return userEvent.setup();
}

describe("<CategoryManager>", () => {
  it("shows the tree with nested subcategories", async () => {
    await renderManager();
    expect(
      within(item("Cookware")).getByRole("listitem", { name: "Skillets" }),
    ).toBeInTheDocument();
    expect(
      within(item("Storage")).getByRole("listitem", { name: "Food Storage" }),
    ).toBeInTheDocument();
  });

  it("creates a category under a parent, appended after its siblings", async () => {
    const bodies = capture("post", "/admin/categories");
    const user = await renderManager();
    const form = screen.getByRole("form", { name: "New category" });
    await user.type(within(form).getByLabelText("Name"), "Woks");
    expect(within(form).getByLabelText("Slug")).toHaveValue("woks");
    await user.selectOptions(within(form).getByLabelText("Parent"), "cat_cookware");
    await user.click(within(form).getByRole("button", { name: "Add category" }));

    expect(
      await within(item("Cookware")).findByRole("listitem", { name: "Woks" }),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ name: "Woks", slug: "woks", parentId: "cat_cookware", position: 3 }]);
  });

  it("renames with the full AdminCategoryInput the API expects", async () => {
    const bodies = capture("patch", "/admin/categories/:id");
    const user = await renderManager();
    await user.click(screen.getByRole("button", { name: "Rename Skillets" }));
    const dialog = screen.getByRole("dialog", { name: "Rename category" });
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Frying Pans");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("listitem", { name: "Frying Pans" })).toBeInTheDocument();
    expect(bodies).toEqual([
      { name: "Frying Pans", slug: "skillets", parentId: "cat_cookware", position: 0 },
    ]);
  });

  it("moves a category to another parent and never offers its own subtree", async () => {
    const bodies = capture("patch", "/admin/categories/:id");
    const user = await renderManager();
    await user.click(screen.getByRole("button", { name: "Move Cookware" }));
    const dialog = screen.getByRole("dialog", { name: "Move Cookware" });
    const parent = within(dialog).getByLabelText("New parent");
    const options = within(parent)
      .getAllByRole("option")
      .map((o) => o.getAttribute("value"));
    expect(options).not.toContain("cat_cookware");
    expect(options).not.toContain("cat_skillets");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Move Spatulas" }));
    const move = screen.getByRole("dialog", { name: "Move Spatulas" });
    await user.selectOptions(within(move).getByLabelText("New parent"), "cat_cookware");
    await user.click(within(move).getByRole("button", { name: "Move" }));

    expect(
      await within(item("Cookware")).findByRole("listitem", { name: "Spatulas" }),
    ).toBeInTheDocument();
    expect(bodies).toEqual([
      { name: "Spatulas", slug: "spatulas", parentId: "cat_cookware", position: 3 },
    ]);
  });

  it("asks for the slug before deleting and shows the API's 409", async () => {
    const user = await renderManager();
    await user.click(screen.getByRole("button", { name: "Delete Cookware" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Cookware?" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "cookware");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Move this category's products and subcategories first.",
    );
  });

  it("deletes an empty category", async () => {
    const user = await renderManager();
    const form = screen.getByRole("form", { name: "New category" });
    await user.type(within(form).getByLabelText("Name"), "Bakeware");
    await user.click(within(form).getByRole("button", { name: "Add category" }));
    await screen.findByRole("listitem", { name: "Bakeware" });

    await user.click(screen.getByRole("button", { name: "Delete Bakeware" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Bakeware?" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "bakeware");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Bakeware" })).not.toBeInTheDocument(),
    );
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { IMAGE_KEY_PATTERN } from "@hp/contracts";
import { ProductEditor } from "@/components/products/ProductEditor";
import { ProductForm } from "@/components/products/ProductForm";
import { seedImageKey } from "@test/mocks/products";
import { mockRouter } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

/** Records the JSON body of every matching request, then lets the mock answer. */
function captureBodies(method: "post" | "patch" | "delete", path: string) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      const text = await request.clone().text();
      bodies.push(text ? JSON.parse(text) : null);
    }),
  );
  return bodies;
}

const variantGroup = (n: number) =>
  screen.getByRole("group", { name: new RegExp(`^Variant ${n}`) });

async function renderEditor(role: "STAFF" | "ADMIN" = "STAFF") {
  renderWithProviders(<ProductEditor id="p_sample_01" />, { role });
  await screen.findByRole("group", { name: /^Variant 1/ });
  return userEvent.setup();
}

describe("<ProductEditor> edit form", () => {
  it("sends only changed fields: a patch for the edited variant and a full new variant", async () => {
    const bodies = captureBodies("patch", "/admin/products/:id");
    const user = await renderEditor();

    const price = within(variantGroup(1)).getByLabelText("Price (OMR)");
    await user.clear(price);
    await user.type(price, "36.995");

    await user.click(screen.getByRole("button", { name: "Add variant" }));
    const added = variantGroup(3);
    await user.type(within(added).getByLabelText("SKU"), "IV-SK14");
    await user.type(within(added).getByLabelText("Name"), "14 inch");
    await user.type(within(added).getByLabelText("Price (OMR)"), "54.99");
    await user.type(within(added).getByLabelText("Initial stock"), "5");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(bodies).toEqual([
      {
        variants: [
          { id: "v_sample_01_1", priceCents: 36_995 },
          {
            sku: "IV-SK14",
            name: "14 inch",
            priceCents: 54_990,
            compareAtPriceCents: null,
            costCents: null,
            initialStock: 5,
            lowStockThreshold: 5,
            weightGrams: null,
            attributes: {},
            isActive: true,
          },
        ],
      },
    ]);
    // After saving, the new variant is an existing one: stock is read-only.
    await waitFor(() =>
      expect(within(variantGroup(3)).queryByLabelText("Initial stock")).not.toBeInTheDocument(),
    );
  });

  it("shows stock read-only on existing variants with a link to inventory", async () => {
    await renderEditor();
    const first = variantGroup(1);
    expect(within(first).queryByLabelText("Initial stock")).not.toBeInTheDocument();
    expect(within(first).getByText("24 on hand")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: /Adjust stock/ })).toHaveAttribute(
      "href",
      "/inventory?q=IV-SK10",
    );
  });

  it("sends nothing but the changed product fields", async () => {
    const bodies = captureBodies("patch", "/admin/products/:id");
    const user = await renderEditor();
    await user.selectOptions(screen.getByLabelText("Status"), "DRAFT");
    await user.selectOptions(screen.getByLabelText("Dishwasher safe"), "yes");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved.");
    expect(bodies).toEqual([{ status: "DRAFT", dishwasherSafe: true }]);
  });

  it("does not call the API when nothing changed", async () => {
    const bodies = captureBodies("patch", "/admin/products/:id");
    const user = await renderEditor();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No changes to save.");
    expect(bodies).toEqual([]);
  });

  it("validates with the contract and hints when compare-at is not above the price", async () => {
    const user = await renderEditor();
    const row = variantGroup(1);
    await user.type(within(row).getByLabelText("Compare-at (OMR)"), "10.00");
    expect(
      within(row).getByText("Compare-at price must be higher than the price."),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Product name"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fix the highlighted fields");
    expect(screen.getByLabelText("Product name")).toHaveAttribute("aria-invalid", "true");
  });

  it("uploads an image (presign → PUT → key), lets it be reordered, and saves the keys", async () => {
    const presigns = captureBodies("post", "/admin/uploads/presign");
    const puts: { contentType: string | null; url: string }[] = [];
    server.use(
      http.put(`${API}/mock-uploads/*`, ({ request }) => {
        puts.push({ contentType: request.headers.get("Content-Type"), url: request.url });
      }),
    );
    const bodies = captureBodies("patch", "/admin/products/:id");
    const user = await renderEditor();

    const file = new File(["fake-png-bytes"], "lid.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Add images"), file);

    const altInputs = await screen.findAllByLabelText(/Alt text/);
    expect(altInputs).toHaveLength(2);
    expect(presigns).toEqual([{ contentType: "image/png", contentLength: file.size }]);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.contentType).toBe("image/png");

    await user.type(altInputs[1]!, "Glass lid");
    await user.click(screen.getByRole("button", { name: "Move image 2 up" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved.");

    const images = (bodies[0] as { images: { key: string; alt: string; position: number }[] })
      .images;
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ alt: "Glass lid", position: 0 });
    expect(images[0]!.key).toMatch(IMAGE_KEY_PATTERN);
    expect(images[1]).toEqual({ key: seedImageKey(1), alt: 'Cast Iron Skillet 10"', position: 1 });
    expect(Object.keys(images[0]!)).toEqual(["key", "alt", "position"]);
  });

  it("rejects the wrong type or an oversized image before asking for an upload URL", async () => {
    const presigns = captureBodies("post", "/admin/uploads/presign");
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<ProductEditor id="p_sample_01" />, { role: "STAFF" });
    const input = await screen.findByLabelText("Add images");

    await user.upload(input, new File(["gif"], "anim.gif", { type: "image/gif" }));
    expect(
      await screen.findByText(/anim.gif: Use a JPG, PNG, WebP or AVIF image./),
    ).toBeInTheDocument();

    const big = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 8 * 1024 * 1024 + 1 });
    await user.upload(input, big);
    expect(
      await screen.findByText(/huge.jpg: Images must be 8 MB or smaller./),
    ).toBeInTheDocument();
    expect(presigns).toEqual([]);
  });

  it("archives only after the slug is typed, for roles with product:delete", async () => {
    const deletes = captureBodies("delete", "/admin/products/:id");
    const user = await renderEditor("ADMIN");
    await user.click(screen.getByRole("button", { name: "Archive product" }));

    const dialog = screen.getByRole("alertdialog", { name: "Archive this product?" });
    const confirm = within(dialog).getByRole("button", { name: "Archive" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/to confirm/), "cast-iron-skillet-10in");
    await user.click(confirm);

    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(await screen.findByLabelText("Status")).toHaveValue("ARCHIVED");
  });

  it("hides archive from STAFF (no product:delete)", async () => {
    await renderEditor("STAFF");
    expect(screen.queryByRole("button", { name: "Archive product" })).not.toBeInTheDocument();
  });
});

describe("<ProductForm> create", () => {
  it("validates, then posts a full AdminProductInput and opens the new product", async () => {
    const bodies = captureBodies("post", "/admin/products");
    const user = userEvent.setup();
    renderWithProviders(<ProductForm />, { role: "STAFF" });

    await user.click(await screen.findByRole("button", { name: "Create product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fix the highlighted fields");
    expect(bodies).toEqual([]);

    await user.type(screen.getByLabelText("Product name"), "Carbon Steel Wok");
    expect(screen.getByLabelText("Slug")).toHaveValue("carbon-steel-wok");
    await user.selectOptions(await screen.findByLabelText("Category"), "cat_skillets");
    await user.type(screen.getByLabelText("Description"), "<p>Seasoned wok.</p>");
    await user.type(screen.getByLabelText("Oven safe to (°F)"), "600");
    const row = variantGroup(1);
    await user.type(within(row).getByLabelText("SKU"), "IV-WOK14");
    await user.type(within(row).getByLabelText("Name"), "14 inch");
    await user.type(within(row).getByLabelText("Price (OMR)"), "59");
    await user.type(within(row).getByLabelText("Cost (OMR)"), "21.50");
    await user.type(within(row).getByLabelText("Initial stock"), "12");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/products\/prod_mock_/),
      ),
    );
    expect(bodies).toEqual([
      {
        name: "Carbon Steel Wok",
        slug: "carbon-steel-wok",
        brand: null,
        categoryId: "cat_skillets",
        description: "<p>Seasoned wok.</p>",
        material: null,
        careInstructions: null,
        dishwasherSafe: null,
        inductionCompatible: null,
        ovenSafeToF: 600,
        status: "DRAFT",
        images: [],
        variants: [
          {
            sku: "IV-WOK14",
            name: "14 inch",
            priceCents: 59_000,
            compareAtPriceCents: null,
            costCents: 21_500,
            initialStock: 12,
            lowStockThreshold: 5,
            weightGrams: null,
            attributes: {},
            isActive: true,
          },
        ],
      },
    ]);
  });

  it("notes that description HTML is sanitized by the server", async () => {
    renderWithProviders(<ProductForm />, { role: "STAFF" });
    expect(await screen.findByText(/sanitized by the server/)).toBeInTheDocument();
  });

  it("rejects more decimals than the store currency has", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductForm />, { role: "STAFF" });
    const row = await screen.findByRole("group", { name: /^Variant 1/ });
    await user.type(within(row).getByLabelText("Price (OMR)"), "12.3456");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await within(row).findByText("Enter an amount like 18.500.")).toBeInTheDocument();
  });

  it("shows the API's conflict message on a duplicate slug", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductForm />, { role: "STAFF" });
    await user.type(await screen.findByLabelText("Product name"), "Chef's Knife 8");
    await user.clear(screen.getByLabelText("Slug"));
    await user.type(screen.getByLabelText("Slug"), "chefs-knife-8in");
    await user.selectOptions(await screen.findByLabelText("Category"), "cat_chefs-knives");
    const row = variantGroup(1);
    await user.type(within(row).getByLabelText("SKU"), "BR-NEW8");
    await user.type(within(row).getByLabelText("Name"), "8 inch");
    await user.type(within(row).getByLabelText("Price (OMR)"), "89");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Another product already uses the slug "chefs-knife-8in".',
    );
  });
});

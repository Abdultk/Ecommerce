import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { fail } from "@hp/contracts";
import { ProductsTable } from "@/components/products/ProductsTable";

import { buildAdminProductRows } from "@test/mocks/products";
import { mockRouter, navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders, shownMoney } from "./utils";

const ALL = buildAdminProductRows();

function bodyRows() {
  const table = screen.getByRole("table", { name: /Products/ });
  const [, ...rows] = within(table).getAllByRole("row");
  return rows;
}

const rowNames = () => bodyRows().map((r) => within(r).getAllByRole("cell")[0]!.textContent ?? "");

async function renderLoaded(pageSize = 5) {
  renderWithProviders(<ProductsTable initialPageSize={pageSize} />, { role: "ADMIN" });
  await screen.findByText(new RegExp(`of ${ALL.length} products`));
}

describe("<ProductsTable> / DataTable", () => {
  beforeEach(() => navigation.reset("/products"));

  it("shows a loading state, then the first server page with a row count", async () => {
    renderWithProviders(<ProductsTable initialPageSize={5} />, { role: "ADMIN" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading products");

    expect(await screen.findByText(`Showing 1–5 of ${ALL.length} products`)).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("pages forward and back through server pages", async () => {
    await renderLoaded();
    const user = userEvent.setup();
    const firstPage = rowNames();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      await screen.findByText(`Showing 6–${ALL.length} of ${ALL.length} products`),
    ).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(ALL.length - 5);
    expect(rowNames()).not.toEqual(firstPage);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText(`Showing 1–5 of ${ALL.length} products`)).toBeInTheDocument();
  });

  it("filters by status on the server", async () => {
    await renderLoaded(25);
    const drafts = ALL.filter((p) => p.status === "DRAFT");
    await userEvent.setup().selectOptions(screen.getByLabelText("Status"), "DRAFT");
    expect(
      await screen.findByText(`Showing 1–${drafts.length} of ${drafts.length} products`),
    ).toBeInTheDocument();
    expect(rowNames()).toEqual(drafts.map((p) => expect.stringContaining(p.name)));
  });

  it("filters to low-stock products and labels them with text, not colour alone", async () => {
    await renderLoaded(25);
    const low = ALL.filter((p) => p.lowStock);
    expect(low.length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByLabelText("Low stock only"));
    await screen.findByText(`Showing 1–${low.length} of ${low.length} products`);
    for (const row of bodyRows()) expect(within(row).getByText("Low stock")).toBeInTheDocument();
  });

  it("searches by name and shows an empty state when nothing matches", async () => {
    await renderLoaded();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search products"), "zzz-no-such-pan");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No products match these filters.")).toBeInTheDocument();
    expect(screen.getByText("0 products")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText(`Showing 1–5 of ${ALL.length} products`)).toBeInTheDocument();
  });

  it("formats prices in the store currency (OMR, 3 decimals)", async () => {
    await renderLoaded(25);
    const first = ALL[0]!;
    const row = bodyRows().find((r) => r.textContent?.includes(first.name))!;
    expect(await within(row).findByText(shownMoney(first.fromPriceCents))).toBeInTheDocument();
    expect(shownMoney(first.fromPriceCents)).toMatch(/\d{3}$/);
  });

  it("sorts on the server and keeps the sort in the URL", async () => {
    await renderLoaded(25);
    const user = userEvent.setup();
    const updated = screen.getByRole("columnheader", { name: /Updated/ });
    expect(updated).toHaveAttribute("aria-sort", "descending");

    const header = screen.getByRole("columnheader", { name: /Name/ });
    await user.click(within(header).getByRole("button"));
    expect(mockRouter.replace).toHaveBeenLastCalledWith("/products?sort=name&dir=asc", {
      scroll: false,
    });
    const sorted = [...ALL].map((p) => p.name).sort((a, b) => a.localeCompare(b));
    await waitFor(() =>
      expect(rowNames().map((n) => sorted.find((s) => n.includes(s)))).toEqual(sorted),
    );
    expect(header).toHaveAttribute("aria-sort", "ascending");

    await user.click(within(header).getByRole("button"));
    await waitFor(() => expect(header).toHaveAttribute("aria-sort", "descending"));
    expect(navigation.getSearch()).toBe("sort=name&dir=desc");
  });

  it("only offers sorting on columns the API can sort by", async () => {
    await renderLoaded(25);
    const category = screen.getByRole("columnheader", { name: "Category" });
    expect(within(category).queryByRole("button")).not.toBeInTheDocument();
    expect(category).not.toHaveAttribute("aria-sort");
  });

  it("restores filters, sort and page from the URL", async () => {
    navigation.reset("/products?status=DRAFT&sort=price&dir=asc");
    renderWithProviders(<ProductsTable initialPageSize={25} />, { role: "ADMIN" });
    const drafts = ALL.filter((p) => p.status === "DRAFT");
    expect(
      await screen.findByText(`Showing 1–${drafts.length} of ${drafts.length} products`),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("DRAFT");
    expect(screen.getByRole("columnheader", { name: /Price from/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("filters by category and resets to page 1", async () => {
    navigation.reset("/products?page=2&pageSize=5");
    renderWithProviders(<ProductsTable initialPageSize={5} />, { role: "ADMIN" });
    await screen.findByText(`Showing 6–${ALL.length} of ${ALL.length} products`);
    await userEvent.setup().selectOptions(await screen.findByLabelText("Category"), "cat_skillets");
    expect(navigation.getSearch()).toBe("pageSize=5&categoryId=cat_skillets");
    expect(await screen.findByText("Showing 1–1 of 1 products")).toBeInTheDocument();
  });

  it("links each product to its edit page and offers New product to writers", async () => {
    await renderLoaded(25);
    const first = ALL[0]!;
    expect(screen.getByRole("link", { name: first.name })).toHaveAttribute(
      "href",
      `/products/${first.id}`,
    );
    expect(screen.getByRole("link", { name: "New product" })).toHaveAttribute(
      "href",
      "/products/new",
    );
  });

  it("shows an error state with a retry", async () => {
    server.use(
      http.get(`${API}/admin/products`, () =>
        HttpResponse.json(fail("INTERNAL", "Something went wrong on our side."), { status: 500 }),
      ),
    );
    renderWithProviders(<ProductsTable initialPageSize={5} />, { role: "ADMIN" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");

    server.resetHandlers();
    const { createAdminMockHandlers } = await import("@test/mocks/handlers");
    server.resetHandlers(...createAdminMockHandlers(API));
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(`Showing 1–5 of ${ALL.length} products`)).toBeInTheDocument();
  });
});

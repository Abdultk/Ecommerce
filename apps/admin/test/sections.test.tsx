import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { fail } from "@hp/contracts";
import { Overview } from "@/components/Overview";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

describe("<Overview>", () => {
  it("shows the low-stock count with a link to the filtered inventory", async () => {
    renderWithProviders(<Overview />, { role: "STAFF" });
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    const stat = await screen.findByRole("link", { name: /3 low-stock variants/ });
    expect(stat).toHaveAttribute("href", "/inventory?lowStock=true");
  });

  it("lists the 10 latest orders, newest first", async () => {
    renderWithProviders(<Overview />, { role: "STAFF" });
    const table = await screen.findByRole("table", { name: "Latest orders" });
    await within(table).findByText("HP-2026-000120");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(10);
    expect(within(rows[0]!).getByRole("link", { name: "HP-2026-000120" })).toHaveAttribute(
      "href",
      "/orders/ord_mock_01",
    );
    expect(screen.getByRole("link", { name: "All orders" })).toHaveAttribute("href", "/orders");
  });

  it("shows an error when a widget can't load", async () => {
    server.use(
      http.get(`${API}/admin/orders`, () =>
        HttpResponse.json(fail("INTERNAL", "Orders are unavailable."), { status: 500 }),
      ),
    );
    renderWithProviders(<Overview />, { role: "STAFF" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Orders are unavailable.");
  });
});

describe("<Overview> analytics", () => {
  it("shows 30-day KPIs, a revenue chart and a link to analytics for ADMIN", async () => {
    renderWithProviders(<Overview />, { role: "ADMIN" });
    for (const name of ["Revenue", "Orders", "Average order", "Refund rate"]) {
      const card = await screen.findByRole("article", { name });
      expect(within(card).getByText(/vs previous 30 days/)).toBeInTheDocument();
    }
    expect(screen.getByRole("figure", { name: "Revenue, last 30 days" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open analytics" })).toHaveAttribute(
      "href",
      "/analytics",
    );
  });

  it("hides revenue figures from STAFF but keeps stock and orders", async () => {
    renderWithProviders(<Overview />, { role: "STAFF" });
    await screen.findByRole("link", { name: /low-stock variants/ });
    expect(screen.queryByRole("article", { name: "Revenue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });
});

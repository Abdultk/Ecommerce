import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { fail, ok, type AnalyticsSummary } from "@hp/contracts";
import AnalyticsPage from "@/app/(dashboard)/analytics/page";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

async function renderDashboard(path = "/analytics") {
  navigation.reset(path);
  renderWithProviders(<AnalyticsDashboard />, { role: "ADMIN" });
  await screen.findByRole("figure", { name: "Revenue" });
  return userEvent.setup();
}

const dataRows = (figureName: string) =>
  within(within(screen.getByRole("figure", { name: figureName })).getByRole("table"))
    .getAllByRole("row")
    .slice(1);

const KPIS: AnalyticsSummary["current"] = {
  revenueCents: 120_000,
  orders: 20,
  aovCents: 6_000,
  refundRate: 0.05,
  newCustomers: 5,
  returningCustomers: 15,
  grossMarginCents: null,
  lowStockSkus: 2,
};

describe("<AnalyticsDashboard>", () => {
  beforeEach(() => navigation.reset("/analytics"));

  it("shows KPIs against the previous period, charts with data tables, and breakdowns", async () => {
    await renderDashboard();
    expect(screen.getByLabelText("Range")).toHaveValue("30d");

    const revenue = screen.getByRole("article", { name: "Revenue" });
    expect(within(revenue).getByText(/vs previous 30 days/)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Refund rate" })).toBeInTheDocument();

    const chart = within(screen.getByRole("figure", { name: "Revenue" })).getByRole("img");
    expect(chart).toHaveAccessibleDescription(/Total OMR\s[\d,.]+ across 30 days/);
    expect(dataRows("Revenue")).toHaveLength(30);
    expect(dataRows("Orders")).toHaveLength(30);

    const top = await screen.findByRole("table", { name: "Top products" });
    expect(within(top).getAllByRole("row").length).toBeGreaterThan(1);
    expect(await screen.findByRole("table", { name: "Sales by category" })).toBeInTheDocument();
    const customers = screen.getByRole("region", { name: "New vs returning customers" });
    expect(within(customers).getByText(/New customers/)).toBeInTheDocument();
    expect(within(customers).getByText(/Returning customers/)).toBeInTheDocument();
  });

  it("lets keyboard users scroll the wide breakdown tables", async () => {
    await renderDashboard();
    for (const name of ["Top products", "Sales by category"]) {
      const table = await screen.findByRole("table", { name });
      const scroller = table.parentElement!;
      expect(scroller).toHaveAttribute("tabindex", "0");
      expect(scroller).toHaveAttribute("role", "region");
      expect(scroller).toHaveAccessibleName(`${name} (scrollable)`);
    }
  });

  it("keeps the range preset and interval in the URL", async () => {
    const user = await renderDashboard();
    await user.selectOptions(screen.getByLabelText("Range"), "7d");
    expect(navigation.getSearch()).toBe("range=7d");
    await waitFor(() => expect(dataRows("Revenue")).toHaveLength(7));

    await user.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(navigation.getSearch()).toBe("range=7d&interval=month");
    await waitFor(() => expect(dataRows("Orders").length).toBeLessThanOrEqual(2));
  });

  it("explains an invalid custom range instead of querying", async () => {
    navigation.reset("/analytics?range=custom&from=2026-10-09&to=2026-10-01");
    renderWithProviders(<AnalyticsDashboard />, { role: "ADMIN" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "End date is before the start date.",
    );
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-09");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("applies custom dates typed into the date fields", async () => {
    const user = await renderDashboard();
    await user.selectOptions(screen.getByLabelText("Range"), "custom");
    await user.type(screen.getByLabelText("From"), "2026-09-01");
    await user.type(screen.getByLabelText("To"), "2026-09-10");
    expect(navigation.getSearch()).toBe("range=custom&from=2026-09-01&to=2026-09-10");
    await waitFor(() => expect(dataRows("Revenue")).toHaveLength(10));
  });

  it("says when gross margin is unavailable and when there was nothing to compare", async () => {
    server.use(
      http.get(`${API}/admin/analytics/summary`, () =>
        HttpResponse.json(
          ok({ current: KPIS, previous: { ...KPIS, revenueCents: 0 }, currency: "OMR" }),
        ),
      ),
    );
    await renderDashboard();
    const margin = await screen.findByRole("article", { name: "Gross margin" });
    expect(within(margin).getByText("Not available")).toBeInTheDocument();
    const revenue = screen.getByRole("article", { name: "Revenue" });
    expect(within(revenue).getByText("No revenue in the previous period")).toBeInTheDocument();
  });

  it("renders product names as text, never as markup", async () => {
    const name = '<img src=x onerror="alert(1)">Pan';
    server.use(
      http.get(`${API}/admin/analytics/top-products`, () =>
        HttpResponse.json(ok([{ productId: "p1", name, unitsSold: 3, revenueCents: 9000 }])),
      ),
    );
    await renderDashboard();
    const top = await screen.findByRole("table", { name: "Top products" });
    expect(await within(top).findByText(name)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows an error when the summary can't load", async () => {
    server.use(
      http.get(`${API}/admin/analytics/summary`, () =>
        HttpResponse.json(fail("INTERNAL", "Analytics are unavailable."), { status: 500 }),
      ),
    );
    await renderDashboard();
    expect(await screen.findByText("Analytics are unavailable.")).toBeInTheDocument();
  });

  it("exports the current range as a report job", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/admin/reports`, async ({ request }) => {
        bodies.push(await request.clone().json());
      }),
    );
    const user = await renderDashboard("/analytics?range=7d");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    const status = await screen.findByText(/Export queued/);
    expect(status.closest("[role=status]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/reports");
    expect(bodies).toEqual([
      {
        type: "sales-by-day",
        format: "csv",
        range: {
          from: expect.stringMatching(/T00:00:00\.000Z$/),
          to: expect.stringMatching(/T23:59:59\.999Z$/),
          interval: "day",
        },
      },
    ]);
  });
});

describe("analytics page", () => {
  it("is blocked for STAFF, who lack analytics:read", () => {
    renderWithProviders(<AnalyticsPage />, { role: "STAFF" });
    expect(screen.getByRole("alert")).toHaveTextContent("No access to Analytics");
  });

  it("opens for ADMIN", async () => {
    renderWithProviders(<AnalyticsPage />, { role: "ADMIN" });
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(await screen.findByRole("figure", { name: "Revenue" })).toBeInTheDocument();
  });
});

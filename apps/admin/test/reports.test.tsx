import { focusManager } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { ok, type ReportJob } from "@hp/contracts";
import ReportsPage from "@/app/(dashboard)/reports/page";
import { ReportsManager } from "@/components/reports/ReportsManager";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

const FAST_POLL_MS = 10;

/** Counts status reads of report jobs (GET /admin/reports/:id). */
function countPolls() {
  const polls: string[] = [];
  server.use(
    http.get(`${API}/admin/reports/:jobId`, ({ params }) => {
      polls.push(String(params.jobId));
      return undefined;
    }),
  );
  return polls;
}

async function renderReports() {
  renderWithProviders(<ReportsManager pollBaseMs={FAST_POLL_MS} />, { role: "ADMIN" });
  await screen.findByRole("table", { name: "Recent reports" });
  return userEvent.setup();
}

const jobRows = () =>
  within(screen.getByRole("table", { name: "Recent reports" }))
    .getAllByRole("row")
    .slice(1);

async function createOrdersReport(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Report"), "orders");
  await user.selectOptions(screen.getByLabelText("Format"), "csv");
  await user.selectOptions(screen.getByLabelText("Range"), "7d");
  await user.click(screen.getByRole("button", { name: "Create report" }));
}

describe("<ReportsManager>", () => {
  afterEach(() => focusManager.setFocused(undefined));

  it("lists recent jobs with status, failure reason and an expired-link refresh", async () => {
    const user = await renderReports();
    const [failed, done] = jobRows();
    expect(within(failed!).getByText("Inventory snapshot")).toBeInTheDocument();
    expect(within(failed!).getByText("Failed")).toBeInTheDocument();
    expect(within(failed!).getByText("The export timed out. Try a shorter range.")).toBeVisible();

    expect(within(done!).getByText("Sales by day")).toBeInTheDocument();
    expect(within(done!).queryByRole("link")).not.toBeInTheDocument();
    await user.click(
      within(done!).getByRole("button", { name: "Get a new link for Sales by day" }),
    );
    const link = await within(done!).findByRole("link", { name: "Download Sales by day (CSV)" });
    expect(link).toHaveAttribute("href", "https://cdn.example.test/reports/rep_seed_1.csv");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows an expired job's file as removed, with no link or refresh", async () => {
    await renderReports();
    const expired = jobRows().find((row) => within(row).queryByText("Expired"));
    expect(expired).toBeDefined();
    expect(within(expired!).getByText("Customers")).toBeInTheDocument();
    expect(within(expired!).getByText("File removed")).toBeInTheDocument();
    expect(within(expired!).queryByRole("link")).not.toBeInTheDocument();
    expect(within(expired!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("creates a job, polls until it is done, announces it and stops polling", async () => {
    const polls = countPolls();
    const user = await renderReports();
    await createOrdersReport(user);

    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Orders report (CSV) is ready."));
    const row = jobRows()[0]!;
    expect(within(row).getByText("Ready")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Download Orders (CSV)" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/cdn\.example\.test\/reports\/rep_mock_\d+\.csv$/),
    );

    const settled = polls.length;
    await new Promise((r) => setTimeout(r, FAST_POLL_MS * 20));
    expect(polls.length).toBe(settled);
  });

  it("pauses polling while the tab is hidden", async () => {
    const polls = countPolls();
    const user = await renderReports();
    focusManager.setFocused(false);
    await createOrdersReport(user);
    await waitFor(() => expect(polls.length).toBe(1)); // the first status read
    await new Promise((r) => setTimeout(r, FAST_POLL_MS * 20));
    expect(polls.length).toBe(1);

    focusManager.setFocused(true);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Orders report (CSV) is ready."),
    );
  });

  it("announces a failed job with its reason", async () => {
    server.use(
      http.get(`${API}/admin/reports/:jobId`, ({ params }) =>
        HttpResponse.json(
          ok({
            ...BASE_JOB,
            id: String(params.jobId),
            status: "failed",
            error: "No orders in that range.",
          }),
        ),
      ),
    );
    const user = await renderReports();
    await createOrdersReport(user);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Orders report (CSV) failed: No orders in that range.",
      ),
    );
  });

  it("validates a custom range before creating anything", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/admin/reports`, async ({ request }) => {
        bodies.push(await request.clone().json());
      }),
    );
    const user = await renderReports();
    await user.selectOptions(screen.getByLabelText("Range"), "custom");
    await user.click(screen.getByRole("button", { name: "Create report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a start and an end date.");
    expect(bodies).toEqual([]);
  });
});

const BASE_JOB: ReportJob = {
  id: "rep_x",
  type: "orders",
  format: "csv",
  status: "queued",
  range: { from: "2026-10-05T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" },
  rowCount: null,
  error: null,
  downloadUrl: null,
  downloadExpiresAt: null,
  requestedByEmail: "admin@hearthandpan.test",
  createdAt: "2026-10-11T10:00:00.000Z",
  completedAt: null,
};

describe("reports page", () => {
  it("is blocked for STAFF, who lack analytics:export", () => {
    renderWithProviders(<ReportsPage />, { role: "STAFF" });
    expect(screen.getByRole("alert")).toHaveTextContent("No access to Reports");
  });

  it("opens for SUPER_ADMIN", async () => {
    renderWithProviders(<ReportsPage />, { role: "SUPER_ADMIN" });
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Recent reports" })).toBeInTheDocument();
  });
});

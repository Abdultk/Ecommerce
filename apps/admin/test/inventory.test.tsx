import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

const rowFor = (sku: string) =>
  screen
    .getAllByRole("row")
    .find((r) => within(r).queryByText(sku, { selector: "span.font-mono" }))!;

async function renderTable(path = "/inventory") {
  navigation.reset(path);
  renderWithProviders(<InventoryTable />, { role: "STAFF" });
  await screen.findByText(/Showing 1–/);
  return userEvent.setup();
}

describe("<InventoryTable>", () => {
  beforeEach(() => navigation.reset("/inventory"));

  it("lists variants, lowest available first, with on-hand, reserved and available", async () => {
    await renderTable();
    const [, first] = screen.getAllByRole("row");
    expect(within(first!).getAllByText("0", { selector: "td" })).toHaveLength(3);
    expect(within(first!).getByText("Low stock")).toBeInTheDocument();
  });

  it("keeps the low-stock filter and search in the URL", async () => {
    const user = await renderTable();
    await user.click(screen.getByLabelText("Low stock only"));
    expect(navigation.getSearch()).toBe("lowStock=true");
    await waitFor(() =>
      screen
        .getAllByRole("row")
        .slice(1)
        .forEach((r) => expect(within(r).getByText("Low stock")).toBeInTheDocument()),
    );
  });

  it("opens filtered by SKU from the product form's link", async () => {
    await renderTable("/inventory?q=IV-SK10");
    expect(screen.getByText("Showing 1–1 of 1 variants")).toBeInTheDocument();
    expect(screen.getByLabelText("Search inventory")).toHaveValue("IV-SK10");
  });

  it("adjusts stock with a reason and shows the new on-hand count", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/admin/inventory/adjust`, async ({ request }) => {
        bodies.push(await request.clone().json());
      }),
    );
    const user = await renderTable("/inventory?q=IV-SK10");
    await user.click(screen.getByRole("button", { name: "Adjust IV-SK10" }));
    const dialog = screen.getByRole("dialog", { name: "Adjust stock · IV-SK10" });

    const reasons = within(within(dialog).getByLabelText("Reason")).getAllByRole("option");
    expect(reasons.map((o) => o.getAttribute("value"))).toEqual([
      "RESTOCK",
      "RETURN",
      "DAMAGE",
      "CORRECTION",
    ]);

    await user.type(within(dialog).getByLabelText("Change"), "6");
    expect(within(dialog).getByText("On hand after: 30")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Note (optional)"), "PO 4471");
    await user.click(within(dialog).getByRole("button", { name: "Save adjustment" }));

    await waitFor(() =>
      expect(bodies).toEqual([
        { variantId: "v_sample_01_1", delta: 6, reason: "RESTOCK", note: "PO 4471" },
      ]),
    );
    await waitFor(() =>
      expect(within(rowFor("IV-SK10")).getAllByText("30", { selector: "td" })).toHaveLength(2),
    );
  });

  it("rejects a zero change and shows the API's error for going below reserved", async () => {
    const user = await renderTable("/inventory?q=NF-DO55-SAG");
    await user.click(screen.getByRole("button", { name: "Adjust NF-DO55-SAG" }));
    const dialog = screen.getByRole("dialog", { name: "Adjust stock · NF-DO55-SAG" });
    await user.type(within(dialog).getByLabelText("Change"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Save adjustment" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter a non-zero change.");

    await user.clear(within(dialog).getByLabelText("Change"));
    await user.type(within(dialog).getByLabelText("Change"), "-1");
    await user.selectOptions(within(dialog).getByLabelText("Reason"), "DAMAGE");
    await user.click(within(dialog).getByRole("button", { name: "Save adjustment" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That would leave -1 on hand, but 0 are reserved by open checkouts.",
    );
  });

  it("shows the movement ledger in a drawer", async () => {
    const user = await renderTable("/inventory?q=IV-SK10");
    await user.click(screen.getByRole("button", { name: "History IV-SK10" }));
    const drawer = screen.getByRole("dialog", { name: "Stock history · IV-SK10" });
    const ledger = await within(drawer).findByRole("table", { name: "Stock movements" });
    expect(within(ledger).getByText("Restock")).toBeInTheDocument();
    expect(within(ledger).getByText("+24")).toBeInTheDocument();
    expect(within(ledger).getByText("Opening stock")).toBeInTheDocument();
  });
});

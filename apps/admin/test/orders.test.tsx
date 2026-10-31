import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { minorToInput } from "@/lib/money";
import { createSeedDb } from "@test/mocks/db";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders, shownMoney } from "./utils";

// Seed orders (test/mocks/seed-orders.ts), all in OMR: 01 pending bank transfer, 02 paid by
// card, 03 paid by a confirmed transfer, 04 processing, 06 shipped, 08 delivered with a
// 10.000 OMR partial refund, 10 cancelled.

const seeded = (id: string) => createSeedDb().orders.find((o) => o.order.id === id)!.order;

function capture(method: "post" | "patch", path: string): unknown[] & { keys: (string | null)[] } {
  const bodies: unknown[] = [];
  const keys: (string | null)[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key"));
      bodies.push(await request.clone().json());
    }),
  );
  // Non-enumerable, so toEqual([]) compares only the recorded bodies.
  return Object.defineProperty(bodies, "keys", { value: keys, enumerable: false }) as unknown[] & {
    keys: (string | null)[];
  };
}

async function renderOrder(id: string, role: "STAFF" | "ADMIN" = "ADMIN") {
  renderWithProviders(<OrderDetailView id={id} />, { role });
  await screen.findByRole("heading", { level: 1 });
  return userEvent.setup();
}

describe("<OrdersTable>", () => {
  beforeEach(() => navigation.reset("/orders"));

  it("lists orders newest first and links to each", async () => {
    renderWithProviders(<OrdersTable />, { role: "STAFF" });
    expect(await screen.findByText("Showing 1–12 of 12 orders")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "HP-2026-000120" })).toHaveAttribute(
      "href",
      "/orders/ord_mock_01",
    );
  });

  it("shows each order's payment method, OMR total and an awaiting-transfer badge", async () => {
    renderWithProviders(<OrdersTable />, { role: "STAFF" });
    await screen.findByText("Showing 1–12 of 12 orders");
    const row = screen.getByRole("link", { name: "HP-2026-000120" }).closest("tr")!;
    expect(within(row).getByText("Bank transfer")).toBeInTheDocument();
    expect(within(row).getByText(/Awaiting transfer/)).toHaveTextContent(/due/);
    const first = seeded("ord_mock_01");
    expect(within(row).getByText(shownMoney(first.totalCents))).toBeInTheDocument();
    const card = screen.getByRole("link", { name: "HP-2026-000119" }).closest("tr")!;
    expect(within(card).getByText("Card")).toBeInTheDocument();
    expect(within(card).queryByText(/Awaiting transfer/)).not.toBeInTheDocument();
  });

  it("filters by payment method in the URL", async () => {
    renderWithProviders(<OrdersTable />, { role: "STAFF" });
    await screen.findByText("Showing 1–12 of 12 orders");
    await userEvent.setup().selectOptions(screen.getByLabelText("Payment method"), "bank_transfer");
    expect(navigation.getSearch()).toBe("paymentMethod=bank_transfer");
    expect(await screen.findByText("Showing 1–2 of 2 orders")).toBeInTheDocument();
  });

  it("keeps status, date range and search in the URL", async () => {
    renderWithProviders(<OrdersTable />, { role: "STAFF" });
    await screen.findByText("Showing 1–12 of 12 orders");
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Status"), "DELIVERED");
    expect(navigation.getSearch()).toBe("status=DELIVERED");
    expect(await screen.findByText("Showing 1–3 of 3 orders")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search orders"), "ben.ito");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(navigation.getSearch()).toBe("status=DELIVERED&q=ben.ito");
    expect(await screen.findByText("Showing 1–2 of 2 orders")).toBeInTheDocument();
  });

  it("filters by an inclusive date range from the URL", async () => {
    navigation.reset("/orders?from=2026-10-09&to=2026-10-09");
    renderWithProviders(<OrdersTable />, { role: "STAFF" });
    expect(await screen.findByText("Showing 1–3 of 3 orders")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-09");
  });

  it("explains an end date before the start date instead of querying", async () => {
    navigation.reset("/orders?from=2026-10-09&to=2026-10-01");
    renderWithProviders(<OrdersTable />, { role: "STAFF" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "End date is before the start date.",
    );
  });
});

describe("<OrderDetailView>", () => {
  it("shows items, totals, address, customer, payment and timeline", async () => {
    await renderOrder("ord_mock_08");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("HP-2026-000113");
    expect(screen.getByText("IV-SK12")).toBeInTheDocument();
    expect(screen.getByText("thw_pay_mock_0008")).toBeInTheDocument();
    const total = seeded("ord_mock_08").totalCents;
    expect(screen.getAllByText(shownMoney(total)).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Ben Ito" })).toHaveAttribute(
      "href",
      "/customers?q=ben.ito%40example.test",
    );
    expect(screen.getByText("Way 3021, Al Khuwair")).toBeInTheDocument();
    expect(screen.getByText("Bawshar, Muscat 133")).toBeInTheDocument();
    expect(screen.getByText("Partly refunded")).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: "Timeline" });
    expect(within(timeline).getAllByRole("listitem").length).toBeGreaterThanOrEqual(5);
  });

  it("offers only the server's allowedStatuses", async () => {
    await renderOrder("ord_mock_02", "STAFF");
    const menu = screen.getByRole("group", { name: "Change status" });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Mark as processing"]);
  });

  it("needs a tracking number to mark an order shipped", async () => {
    const bodies = capture("patch", "/admin/orders/:id/status");
    const user = await renderOrder("ord_mock_04", "STAFF");
    await user.click(screen.getByRole("button", { name: "Mark as shipped" }));
    const dialog = screen.getByRole("dialog", { name: "Mark as shipped" });
    await user.click(within(dialog).getByRole("button", { name: "Update status" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Add a tracking number to mark the order as shipped.",
    );
    expect(bodies).toEqual([]);

    await user.type(within(dialog).getByLabelText("Tracking number"), "1Z999AA10123456784");
    await user.click(within(dialog).getByRole("button", { name: "Update status" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Mark as shipped" })).not.toBeInTheDocument(),
    );
    expect(bodies).toEqual([{ status: "SHIPPED", trackingNumber: "1Z999AA10123456784" }]);
    expect(await screen.findByText("Shipped", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as delivered" })).toBeInTheDocument();
  });

  it("cancels with a reason only when canCancel", async () => {
    const bodies = capture("post", "/admin/orders/:id/cancel");
    const user = await renderOrder("ord_mock_01", "STAFF");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel HP-2026-000120?" });
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "Customer asked");
    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000120");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(bodies).toEqual([{ reason: "Customer asked" }]));
    expect(await screen.findByText("Cancelled", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
  });

  it("hides cancel for orders that can't be cancelled", async () => {
    await renderOrder("ord_mock_06", "ADMIN");
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
  });

  it("validates the refund against the remaining amount and requires the order number", async () => {
    const bodies = capture("post", "/admin/orders/:id/refund");
    const user = await renderOrder("ord_mock_08", "ADMIN");
    await user.click(screen.getByRole("button", { name: "Refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Refund HP-2026-000113" });

    const order = seeded("ord_mock_08");
    const refundable = order.totalCents - order.refundedCents;
    const amount = within(dialog).getByLabelText("Amount (OMR)");
    expect(amount).toHaveValue(minorToInput(refundable, "OMR"));
    expect(within(dialog).queryByLabelText("Bank reference")).not.toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Refund" });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000113");
    await user.clear(amount);
    await user.type(amount, minorToInput(refundable + 1, "OMR"));
    await user.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      `You can refund at most ${shownMoney(refundable)}.`,
    );

    await user.clear(amount);
    await user.type(amount, "20.5");
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "Scratched lid");
    await user.click(submit);
    await waitFor(() => expect(bodies).toEqual([{ amountCents: 20_500, reason: "Scratched lid" }]));
    const refunds = await screen.findByRole("table", { name: "Refunds" });
    expect(within(refunds).getByText(shownMoney(20_500))).toBeInTheDocument();
  });

  it("requires a bank reference to refund a bank-transfer order", async () => {
    const bodies = capture("post", "/admin/orders/:id/refund");
    const user = await renderOrder("ord_mock_03", "ADMIN");
    expect(screen.getByText("BMCT000118")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Refund HP-2026-000118" });
    expect(dialog).toHaveTextContent(/refund it from the store's bank account/i);
    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000118");
    await user.click(within(dialog).getByRole("button", { name: "Refund" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter the bank reference of the refund transfer.",
    );
    expect(bodies).toEqual([]);

    await user.type(within(dialog).getByLabelText("Bank reference"), "BMCT-RF-001");
    await user.click(within(dialog).getByRole("button", { name: "Refund" }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { amountCents: seeded("ord_mock_03").totalCents, bankReference: "BMCT-RF-001" },
      ]),
    );
    const refunds = await screen.findByRole("table", { name: "Refunds" });
    expect(within(refunds).getByText("BMCT-RF-001")).toBeInTheDocument();
  });
});

describe("Confirm transfer received", () => {
  const ORDER = "ord_mock_01";

  it("shows the awaiting-transfer details and hides the action from STAFF", async () => {
    await renderOrder(ORDER, "STAFF");
    expect(screen.getAllByText(/Awaiting transfer/)[0]).toHaveTextContent(/due/);
    expect(screen.getByText("OM810180000001299123456")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm transfer received" }),
    ).not.toBeInTheDocument();
  });

  it("prefills the total, requires a bank reference and sends an Idempotency-Key", async () => {
    const bodies = capture("post", "/admin/orders/:id/confirm-transfer");
    const user = await renderOrder(ORDER, "ADMIN");
    await user.click(screen.getByRole("button", { name: "Confirm transfer received" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm transfer for HP-2026-000120" });
    const total = seeded(ORDER).totalCents;
    expect(within(dialog).getByLabelText("Amount received (OMR)")).toHaveValue(
      minorToInput(total, "OMR"),
    );
    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000120");
    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter the bank reference.");
    expect(bodies).toEqual([]);

    await user.type(within(dialog).getByLabelText("Bank reference"), "BMCT-77812");
    await user.type(within(dialog).getByLabelText("Note (optional)"), "Seen on statement");
    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { receivedCents: total, bankReference: "BMCT-77812", note: "Seen on statement" },
      ]),
    );
    expect(bodies.keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Paid", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByText("BMCT-77812")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm transfer received" }),
    ).not.toBeInTheDocument();
  });

  it("explains an amount mismatch and keeps the dialog open", async () => {
    const user = await renderOrder(ORDER, "ADMIN");
    await user.click(screen.getByRole("button", { name: "Confirm transfer received" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm transfer for HP-2026-000120" });
    const amount = within(dialog).getByLabelText("Amount received (OMR)");
    await user.clear(amount);
    await user.type(amount, "1.000");
    await user.type(within(dialog).getByLabelText("Bank reference"), "BMCT-1");
    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000120");
    await user.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("doesn't match the order total");
    expect(alert).toHaveTextContent(shownMoney(seeded(ORDER).totalCents));
    expect(screen.getByText("Pending payment", { selector: ".badge" })).toBeInTheDocument();
  });

  it("hides refunds from STAFF (no order:refund)", async () => {
    await renderOrder("ord_mock_08", "STAFF");
    expect(screen.queryByRole("button", { name: "Refund" })).not.toBeInTheDocument();
  });
});

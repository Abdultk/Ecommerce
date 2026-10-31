import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { fail } from "@hp/contracts";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { createIdempotencyKeys } from "@/lib/idempotency";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Records each request's Idempotency-Key; the first `failures` calls get a 503. */
function captureKeys(path: string, failures = 0) {
  const keys: (string | null)[] = [];
  server.use(
    http.post(`${API}${path}`, ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key"));
      if (keys.length <= failures) {
        return HttpResponse.json(fail("INTERNAL", "Temporarily unavailable."), { status: 503 });
      }
      return undefined;
    }),
  );
  return keys;
}

describe("createIdempotencyKeys", () => {
  it("reuses a key for the same action until it settles", () => {
    let n = 0;
    const keys = createIdempotencyKeys(() => `key-${++n}`);
    expect(keys.keyFor("a")).toBe("key-1");
    expect(keys.keyFor("a")).toBe("key-1");
    expect(keys.keyFor("b")).toBe("key-2");
    keys.settle();
    expect(keys.keyFor("b")).toBe("key-3");
  });

  it("generates RFC 4122 v4 UUIDs by default", () => {
    expect(createIdempotencyKeys().keyFor("x")).toMatch(UUID);
  });
});

describe("stock adjustment", () => {
  async function openAdjust() {
    navigation.reset("/inventory?q=IV-SK10");
    renderWithProviders(<InventoryTable />, { role: "STAFF" });
    await screen.findByText(/Showing 1–/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Adjust IV-SK10" }));
    return { user, dialog: screen.getByRole("dialog", { name: "Adjust stock · IV-SK10" }) };
  }

  it("retries with the same key and uses a new one when the input changes", async () => {
    const keys = captureKeys("/admin/inventory/adjust", 2);
    const { user, dialog } = await openAdjust();
    const save = within(dialog).getByRole("button", { name: "Save adjustment" });
    await user.type(within(dialog).getByLabelText("Change"), "6");

    await user.click(save);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Temporarily unavailable.");
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(2));

    await user.type(within(dialog).getByLabelText("Note (optional)"), "PO 4471");
    await user.click(save);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Adjust stock/ })).not.toBeInTheDocument(),
    );

    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toMatch(UUID);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe("order cancel and refund", () => {
  async function renderOrder(id: string) {
    renderWithProviders(<OrderDetailView id={id} />, { role: "ADMIN" });
    await screen.findByRole("heading", { level: 1 });
    return userEvent.setup();
  }

  it("sends an Idempotency-Key with a cancel", async () => {
    const keys = captureKeys("/admin/orders/:id/cancel");
    const user = await renderOrder("ord_mock_01");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel HP-2026-000120?" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000120");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(keys).toEqual([expect.stringMatching(UUID)]));
  });

  it("reuses the refund key when the same refund is retried", async () => {
    const keys = captureKeys("/admin/orders/:id/refund", 1);
    const user = await renderOrder("ord_mock_08");
    await user.click(screen.getByRole("button", { name: "Refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Refund HP-2026-000113" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "HP-2026-000113");
    const submit = within(dialog).getByRole("button", { name: "Refund" });

    await user.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Temporarily unavailable.");
    await user.click(submit);
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toBe(keys[0]);
  });
});

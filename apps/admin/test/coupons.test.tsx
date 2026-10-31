import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { CouponsManager } from "@/components/coupons/CouponsManager";
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

async function renderCoupons() {
  renderWithProviders(<CouponsManager />, { role: "ADMIN" });
  await screen.findByText("WELCOME10", { selector: "span.font-mono" });
  return userEvent.setup();
}

describe("<CouponsManager>", () => {
  it("describes each coupon's value by type", async () => {
    await renderCoupons();
    expect(screen.getByText("10% off")).toBeInTheDocument();
    expect(screen.getByText("Free shipping")).toBeInTheDocument();
    expect(screen.getByText("OMR 5.000 off")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows the value field that matches the type", async () => {
    const user = await renderCoupons();
    await user.click(screen.getByRole("button", { name: "New coupon" }));
    const dialog = screen.getByRole("dialog", { name: "New coupon" });
    const type = within(dialog).getByLabelText("Type");

    expect(within(dialog).getByLabelText("Percent off (%)")).toBeInTheDocument();
    await user.selectOptions(type, "FIXED");
    expect(within(dialog).queryByLabelText("Percent off (%)")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Amount off (OMR)")).toBeInTheDocument();
    await user.selectOptions(type, "FREE_SHIPPING");
    expect(within(dialog).queryByLabelText("Amount off (OMR)")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Percent off (%)")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/no discount value/)).toBeInTheDocument();
  });

  it("creates a fixed-amount coupon with cents and plain dates", async () => {
    const bodies = capture("post", "/admin/coupons");
    const user = await renderCoupons();
    await user.click(screen.getByRole("button", { name: "New coupon" }));
    const dialog = screen.getByRole("dialog", { name: "New coupon" });
    await user.type(within(dialog).getByLabelText("Code"), "fall750");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "FIXED");
    await user.type(within(dialog).getByLabelText("Amount off (OMR)"), "7.500");
    await user.type(within(dialog).getByLabelText("Starts"), "2026-11-01");
    await user.type(within(dialog).getByLabelText("Ends"), "2026-11-30");
    await user.click(within(dialog).getByRole("button", { name: "Create coupon" }));

    expect(await screen.findByText("FALL750", { selector: "span.font-mono" })).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        code: "FALL750",
        type: "FIXED",
        value: 7500,
        minSubtotalCents: 0,
        maxRedemptions: null,
        perCustomerLimit: 1,
        startsAt: "2026-11-01",
        endsAt: "2026-11-30",
        isActive: true,
        categoryIds: [],
      },
    ]);
  });

  it("sends value 0 for free shipping and validates the date range", async () => {
    const bodies = capture("post", "/admin/coupons");
    const user = await renderCoupons();
    await user.click(screen.getByRole("button", { name: "New coupon" }));
    const dialog = screen.getByRole("dialog", { name: "New coupon" });
    await user.type(within(dialog).getByLabelText("Code"), "SHIPFREE");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "FREE_SHIPPING");
    await user.type(within(dialog).getByLabelText("Starts"), "2026-11-30");
    await user.type(within(dialog).getByLabelText("Ends"), "2026-11-01");
    await user.click(within(dialog).getByRole("button", { name: "Create coupon" }));
    expect(
      await within(dialog).findByText("End date must be after the start date."),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.clear(within(dialog).getByLabelText("Ends"));
    await user.click(within(dialog).getByRole("button", { name: "Create coupon" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ code: "SHIPFREE", type: "FREE_SHIPPING", value: 0 });
    expect(bodies[0]).not.toHaveProperty("endsAt");
  });

  it("rejects a percent outside 1–100", async () => {
    const user = await renderCoupons();
    await user.click(screen.getByRole("button", { name: "New coupon" }));
    const dialog = screen.getByRole("dialog", { name: "New coupon" });
    await user.type(within(dialog).getByLabelText("Code"), "BIG");
    await user.type(within(dialog).getByLabelText("Percent off (%)"), "150");
    await user.click(within(dialog).getByRole("button", { name: "Create coupon" }));
    expect(
      await within(dialog).findByText("Enter a percentage from 1 to 100."),
    ).toBeInTheDocument();
  });

  it("edits with a full CouponInput via PATCH", async () => {
    const bodies = capture("patch", "/admin/coupons/:id");
    const user = await renderCoupons();
    await user.click(screen.getByRole("button", { name: "Edit WELCOME10" }));
    const dialog = screen.getByRole("dialog", { name: "Edit WELCOME10" });
    const percent = within(dialog).getByLabelText("Percent off (%)");
    expect(percent).toHaveValue("10");
    await user.clear(percent);
    await user.type(percent, "15");
    await user.click(within(dialog).getByRole("button", { name: "Save coupon" }));

    expect(await screen.findByText("15% off")).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        code: "WELCOME10",
        type: "PERCENT",
        value: 15,
        minSubtotalCents: 0,
        maxRedemptions: null,
        perCustomerLimit: 1,
        isActive: true,
        categoryIds: [],
      },
    ]);
  });

  it("deactivates a used coupon after the code is typed", async () => {
    const user = await renderCoupons();
    await user.click(screen.getByRole("button", { name: "Remove WELCOME10" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove WELCOME10?" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "WELCOME10");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "WELCOME10 has been used, so it was deactivated instead of deleted.",
    );
  });
});

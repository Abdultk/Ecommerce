import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

function capture(method: "patch" | "put" | "post", path: string) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

const section = (name: string) => screen.getByRole("region", { name });

async function renderSettings(role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  navigation.reset("/settings");
  renderWithProviders(<SettingsPage />, { role });
  await screen.findByLabelText("Store name");
  return userEvent.setup();
}

describe("<SettingsPage>", () => {
  beforeEach(() => navigation.reset("/settings"));

  it("shows each section with the store's current values", async () => {
    await renderSettings();
    expect(screen.getByLabelText("Store name")).toHaveValue("Hearth & Pan");
    expect(screen.getByLabelText("VAT (%)")).toHaveValue("5");
    expect(screen.getByLabelText("Standard rate (OMR)")).toHaveValue("2.000");
    expect(screen.getByLabelText("Bank name")).toHaveValue("Bank Muscat");
    expect(
      screen.getByLabelText("Hold stock for unpaid transfers and other methods (hours)"),
    ).toHaveValue("24");
  });

  it("saves only the general fields that changed", async () => {
    const bodies = capture("patch", "/admin/settings/general");
    const user = await renderSettings();
    const general = section("General");
    const vat = within(general).getByLabelText("VAT (%)");
    await user.clear(vat);
    await user.type(vat, "5.25");
    await user.click(within(general).getByRole("button", { name: "Save changes" }));
    expect(await within(general).findByRole("status")).toHaveTextContent("Saved.");
    expect(bodies).toEqual([{ vatRateBps: 525 }]);
  });

  it("explains a VAT rate above 25% and sends nothing", async () => {
    const bodies = capture("patch", "/admin/settings/general");
    const user = await renderSettings();
    const general = section("General");
    const vat = within(general).getByLabelText("VAT (%)");
    await user.clear(vat);
    await user.type(vat, "26");
    await user.click(within(general).getByRole("button", { name: "Save changes" }));
    expect(await within(general).findByText("VAT can be at most 25%.")).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("shows the settings read-only to admins who can't change them", async () => {
    await renderSettings("ADMIN");
    expect(screen.getByLabelText("Store name")).toBeDisabled();
    expect(screen.getByText(/only a super admin can change them/i)).toBeInTheDocument();
  });

  it("asks for a 2FA code before saving changed bank details", async () => {
    const bodies = capture("patch", "/admin/settings/payments");
    const user = await renderSettings();
    const payments = section("Payments");
    const accountName = within(payments).getByLabelText("Account name");
    await user.clear(accountName);
    await user.type(accountName, "Hearth Trading");
    await user.click(within(payments).getByRole("button", { name: "Save changes" }));
    expect(
      await within(payments).findByText("Enter the 6-digit code from your authenticator app."),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("adds an admin-defined payment method and saves it with a 2FA code", async () => {
    const bodies = capture("patch", "/admin/settings/payments");
    const user = await renderSettings();
    const payments = section("Payments");
    expect(within(payments).getByText(/no other payment methods yet/i)).toBeInTheDocument();

    await user.click(within(payments).getByRole("button", { name: "Add a payment method" }));
    await user.type(within(payments).getByLabelText("Name customers see"), "Cash on delivery");
    await user.type(
      within(payments).getByLabelText("Instructions for the customer"),
      "Pay the courier in cash.",
    );
    await user.type(within(payments).getByLabelText(/^2FA code/), "123456");
    await user.click(within(payments).getByRole("button", { name: "Save changes" }));

    expect(await within(payments).findByRole("status")).toHaveTextContent("Saved.");
    expect(bodies).toEqual([
      {
        manualMethods: [
          {
            id: "cash-on-delivery",
            label: "Cash on delivery",
            instructions: "Pay the courier in cash.",
            enabled: true,
          },
        ],
        totpCode: "123456",
      },
    ]);
  });

  it("explains a missing name and sends nothing", async () => {
    const bodies = capture("patch", "/admin/settings/payments");
    const user = await renderSettings();
    const payments = section("Payments");
    await user.click(within(payments).getByRole("button", { name: "Add a payment method" }));
    await user.type(within(payments).getByLabelText(/^2FA code/), "123456");
    await user.click(within(payments).getByRole("button", { name: "Save changes" }));
    expect(await within(payments).findAllByText("Required.")).toHaveLength(2);
    expect(bodies).toEqual([]);
  });

  it("needs the new currency typed and a 2FA code before changing it", async () => {
    const bodies = capture("put", "/admin/settings/currency");
    const user = await renderSettings();
    const currency = section("Currency");
    await user.selectOptions(within(currency).getByLabelText("New store currency"), "USD");
    await user.click(within(currency).getByRole("button", { name: "Change currency" }));
    expect(
      await within(currency).findByText("Type the currency code exactly to confirm."),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("shows the API's message when the currency is locked by existing orders", async () => {
    const bodies = capture("put", "/admin/settings/currency");
    const user = await renderSettings();
    const currency = section("Currency");
    await user.selectOptions(within(currency).getByLabelText("New store currency"), "USD");
    await user.type(
      within(currency).getByLabelText("Type the new currency code to confirm"),
      "USD",
    );
    await user.type(within(currency).getByLabelText("2FA code"), "123456");
    await user.click(within(currency).getByRole("button", { name: "Change currency" }));
    expect(await within(currency).findByRole("alert")).toHaveTextContent(/currency is locked/);
    expect(bodies).toHaveLength(1);
  });
});

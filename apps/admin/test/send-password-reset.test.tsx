import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { UsersTable } from "@/components/users/UsersTable";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

function capture(path: string) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}${path}`, async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

describe("Send password reset (users)", () => {
  beforeEach(() => navigation.reset("/customers"));

  it("lets ADMIN email a reset link to a customer after typing their email", async () => {
    const bodies = capture("/admin/users/:id/password-reset");
    renderWithProviders(<UsersTable defaultRole="CUSTOMER" />, { role: "ADMIN" });
    const user = userEvent.setup();
    const [button] = await screen.findAllByRole("button", { name: /Send password reset/ });
    await user.click(button!);

    const dialog = screen.getByRole("alertdialog");
    const email = dialog.textContent?.match(/Send a password reset to (\S+)\?/)?.[1];
    expect(email).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/to confirm/), email!);
    await user.click(within(dialog).getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText(`Reset link sent to ${email}.`)).toBeInTheDocument();
    expect(bodies).toEqual([{}]);
  });

  it("hides the reset for staff from ADMIN", async () => {
    renderWithProviders(<UsersTable defaultRole="ADMIN" />, { role: "ADMIN" });
    expect(await screen.findByText(/Showing .* people/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Send password reset/ })).toHaveLength(0);
  });

  it("offers SUPER_ADMIN a reset for staff, with the option to reset 2FA too", async () => {
    renderWithProviders(<UsersTable defaultRole="ADMIN" />, { role: "SUPER_ADMIN" });
    const [button] = await screen.findAllByRole("button", { name: /Send password reset/ });
    await userEvent.setup().click(button!);
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByLabelText("Also reset their 2FA and send a new invite"),
    ).not.toBeChecked();
  });
});

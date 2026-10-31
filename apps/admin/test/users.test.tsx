import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { InviteStaffForm } from "@/components/users/InviteStaffForm";
import { UsersTable } from "@/components/users/UsersTable";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

function capture(method: "post" | "patch", path: string) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      const text = await request.clone().text();
      bodies.push(text ? JSON.parse(text) : null);
    }),
  );
  return bodies;
}

const rowFor = (email: string) =>
  screen
    .getAllByRole("row")
    .find((r) => within(r).queryByText(email, { selector: ".user-email" }))!;

async function renderStaff(role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  navigation.reset("/staff");
  renderWithProviders(<UsersTable defaultRole="ALL" />, { role });
  await screen.findByText("owner@hearthandpan.test", { selector: ".user-email" });
  return userEvent.setup();
}

describe("<UsersTable>", () => {
  beforeEach(() => navigation.reset("/customers"));

  it("defaults the customers view to the CUSTOMER role and keeps the filter in the URL", async () => {
    renderWithProviders(<UsersTable defaultRole="CUSTOMER" />, { role: "ADMIN" });
    expect(await screen.findByText("Showing 1–3 of 3 people")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveValue("CUSTOMER");

    await userEvent.setup().selectOptions(screen.getByLabelText("Role"), "ADMIN");
    expect(navigation.getSearch()).toBe("role=ADMIN");
    expect(await screen.findByText("Showing 1–2 of 2 people")).toBeInTheDocument();
  });

  it("shows no account controls to ADMIN (user:read without user:write)", async () => {
    await renderStaff("ADMIN");
    expect(screen.queryByRole("button", { name: /^Change role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Disable/ })).not.toBeInTheDocument();
  });

  it("changes another user's role after the email is typed", async () => {
    const bodies = capture("patch", "/admin/users/:id");
    const user = await renderStaff();
    await user.click(screen.getByRole("button", { name: "Change role admin@hearthandpan.test" }));
    const dialog = screen.getByRole("alertdialog", { name: "Change role for Priya Nair" });
    await user.selectOptions(within(dialog).getByLabelText("New role"), "STAFF");
    await user.type(within(dialog).getByLabelText(/to confirm/), "admin@hearthandpan.test");
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));

    await waitFor(() => expect(bodies).toEqual([{ role: "STAFF" }]));
    await waitFor(() =>
      expect(within(rowFor("admin@hearthandpan.test")).getByText("Staff")).toBeInTheDocument(),
    );
  });

  it("shows the API's refusal when a super admin tries to demote themselves", async () => {
    const user = await renderStaff();
    await user.click(screen.getByRole("button", { name: "Change role owner@hearthandpan.test" }));
    const dialog = screen.getByRole("alertdialog", { name: "Change role for Morgan Hale (you)" });
    await user.selectOptions(within(dialog).getByLabelText("New role"), "ADMIN");
    await user.type(within(dialog).getByLabelText(/to confirm/), "owner@hearthandpan.test");
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You can't change your own role or access.",
    );
  });

  it("disables with typed confirmation and re-enables in one step", async () => {
    const bodies = capture("patch", "/admin/users/:id");
    const user = await renderStaff();
    await user.click(screen.getByRole("button", { name: "Disable staff@hearthandpan.test" }));
    const dialog = screen.getByRole("alertdialog", { name: "Disable Sam Ortiz?" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "staff@hearthandpan.test");
    await user.click(within(dialog).getByRole("button", { name: "Disable account" }));
    await waitFor(() =>
      expect(within(rowFor("staff@hearthandpan.test")).getByText("Disabled")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Enable staff@hearthandpan.test" }));
    await waitFor(() => expect(bodies).toEqual([{ disabled: true }, { disabled: false }]));
  });

  it("resends an invite to a staff member", async () => {
    const bodies = capture("post", "/admin/users/:id/invite");
    const user = await renderStaff();
    await user.click(screen.getByRole("button", { name: "Resend invite admin@hearthandpan.test" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reset access for Priya Nair?" });
    await user.type(within(dialog).getByLabelText(/to confirm/), "admin@hearthandpan.test");
    await user.click(within(dialog).getByRole("button", { name: "Send new invite" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "New invite sent to admin@hearthandpan.test.",
    );
  });
});

describe("<InviteStaffForm>", () => {
  it("invites a new staff member", async () => {
    const bodies = capture("post", "/admin/users/invite");
    const user = userEvent.setup();
    renderWithProviders(<InviteStaffForm />, { role: "SUPER_ADMIN" });
    await user.type(screen.getByLabelText("Email"), "Chef@HearthAndPan.test");
    await user.type(screen.getByLabelText("First name"), "Lee");
    await user.type(screen.getByLabelText("Last name"), "Park");
    await user.selectOptions(screen.getByLabelText("Role"), "ADMIN");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Invite sent to chef@hearthandpan.test.",
    );
    expect(bodies).toEqual([
      { email: "chef@hearthandpan.test", firstName: "Lee", lastName: "Park", role: "ADMIN" },
    ]);
  });

  it("shows field errors and the API's conflict for an existing email", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InviteStaffForm />, { role: "SUPER_ADMIN" });
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "admin@hearthandpan.test");
    await user.type(screen.getByLabelText("First name"), "Pri");
    await user.type(screen.getByLabelText("Last name"), "N");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with that email already exists. Change its role instead.",
    );
  });

  it("renders nothing for roles without user:write", () => {
    renderWithProviders(<InviteStaffForm />, { role: "ADMIN" });
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
  });
});

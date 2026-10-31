import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { ProfilePage } from "@/components/profile/ProfilePage";
import { MOCK_PASSWORD } from "@test/mocks/accounts";
import { navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

function capture(method: "patch" | "post", path: string) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

const section = (name: string) => screen.getByRole("region", { name });

async function renderProfile() {
  navigation.reset("/profile");
  renderWithProviders(<ProfilePage />, { role: "ADMIN" });
  await screen.findByLabelText("First name");
  return userEvent.setup();
}

describe("<ProfilePage>", () => {
  beforeEach(() => navigation.reset("/profile"));

  it("saves a changed first name and sends nothing when nothing changed", async () => {
    const bodies = capture("patch", "/admin/me");
    const user = await renderProfile();
    const name = section("Your name");
    await user.click(within(name).getByRole("button", { name: "Save changes" }));
    expect(await within(name).findByRole("status")).toHaveTextContent("Nothing changed.");

    const first = within(name).getByLabelText("First name");
    await user.clear(first);
    await user.type(first, "Grace");
    await user.click(within(name).getByRole("button", { name: "Save changes" }));
    expect(await within(name).findByRole("status")).toHaveTextContent("Name saved.");
    expect(bodies).toEqual([{ firstName: "Grace" }]);
  });

  it("rejects a new password that doesn't match and sends nothing", async () => {
    const bodies = capture("post", "/admin/me/password");
    const user = await renderProfile();
    const passwords = section("Change password");
    await user.type(within(passwords).getByLabelText("Current password"), MOCK_PASSWORD);
    await user.type(within(passwords).getByLabelText("2FA code"), "123456");
    await user.type(within(passwords).getByLabelText("New password"), "a brand new passphrase");
    await user.type(
      within(passwords).getByLabelText("Confirm new password"),
      "something else entirely",
    );
    await user.click(within(passwords).getByRole("button", { name: "Save changes" }));
    expect(
      await within(passwords).findByText("The new passwords don't match."),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it("changes the password with the current password and a 2FA code", async () => {
    const bodies = capture("post", "/admin/me/password");
    const user = await renderProfile();
    const passwords = section("Change password");
    await user.type(within(passwords).getByLabelText("Current password"), MOCK_PASSWORD);
    await user.type(within(passwords).getByLabelText("2FA code"), "123456");
    await user.type(within(passwords).getByLabelText("New password"), "a brand new passphrase");
    await user.type(
      within(passwords).getByLabelText("Confirm new password"),
      "a brand new passphrase",
    );
    await user.click(within(passwords).getByRole("button", { name: "Save changes" }));
    expect(await within(passwords).findByRole("status")).toHaveTextContent(
      "Password changed. Your other devices were signed out.",
    );
    expect(bodies).toEqual([
      {
        currentPassword: MOCK_PASSWORD,
        newPassword: "a brand new passphrase",
        totpCode: "123456",
      },
    ]);
  });

  it("signs out other devices on request", async () => {
    const calls: string[] = [];
    server.use(
      http.post(`${API}/admin/me/sessions/revoke-others`, () => {
        calls.push("revoke-others");
      }),
    );
    const user = await renderProfile();
    await user.click(screen.getByRole("button", { name: "Sign out other devices" }));
    expect(await screen.findByText("Other devices were signed out.")).toBeInTheDocument();
    expect(calls).toEqual(["revoke-others"]);
  });
});

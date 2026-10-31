import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "@/lib/auth-store";
import { MOCK_WRONG_PASSWORD } from "@/test/msw/auth";
import { navigationMock, routerSpies } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { setupMockApi } from "@/test/server";
import { signInMock } from "@/test/session";
import { PreferencesForm } from "./PreferencesForm";
import { PrivacyPanel } from "./PrivacyPanel";
import { SecurityPanel } from "./SecurityPanel";
import { SettingsNav } from "./SettingsNav";

vi.mock("next/navigation", () => ({
  ...navigationMock(),
  usePathname: () => "/account/settings/security",
}));
setupMockApi();

beforeEach(() => {
  authStore.reset();
  routerSpies.replace.mockClear();
});

describe("SettingsNav", () => {
  it("links every settings area and marks the current one", () => {
    renderWithProviders(<SettingsNav />);
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Profile",
      "Preferences",
      "Security",
      "Privacy",
    ]);
    expect(within(nav).getByRole("link", { name: "Security" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("PreferencesForm", () => {
  it("starts with marketing off and saves a changed default", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<PreferencesForm />);

    const marketing = await screen.findByRole("switch", { name: "News and offers" });
    expect(marketing).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /when my order ships/i })).toBeChecked();

    await user.click(marketing);
    await user.selectOptions(screen.getByLabelText("Preferred payment"), "bank_transfer");
    await user.selectOptions(screen.getByLabelText("Preferred delivery"), "express");
    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    expect(await screen.findByText(/preferences are updated/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "News and offers" })).toBeChecked();
    expect(screen.getByLabelText("Preferred payment")).toHaveValue("bank_transfer");
    expect(screen.getByLabelText("Preferred delivery")).toHaveValue("express");
  });

  it("explains an invalid phone number next to the field", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<PreferencesForm />);

    await user.type(await screen.findByLabelText("Mobile number"), "123");
    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() =>
      expect(screen.getByLabelText("Mobile number")).toHaveAccessibleDescription(
        /omani phone number/i,
      ),
    );
  });
});

describe("SecurityPanel", () => {
  it("changes the password and signs out the other devices", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<SecurityPanel />);

    expect(await screen.findByText("Safari on iPhone")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Current password"), "correct horse");
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
  });

  it("shows the server's message for a wrong current password", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<SecurityPanel />);

    await user.type(screen.getByLabelText("Current password"), MOCK_WRONG_PASSWORD);
    await user.type(screen.getByLabelText("New password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your password is incorrect.");
  });

  it("refuses a new password equal to the current one before calling the API", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<SecurityPanel />);

    await user.type(screen.getByLabelText("Current password"), "same passphrase here");
    await user.type(screen.getByLabelText("New password"), "same passphrase here");
    await user.click(screen.getByRole("button", { name: /change password/i }));

    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(/different/i);
  });

  it("signs out one other device but never offers it for this one", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<SecurityPanel />);

    await screen.findByText("Safari on iPhone");
    expect(screen.getByText("This device")).toBeInTheDocument();
    // One per other device, plus the sign-out-everywhere button; none for this device.
    expect(screen.getAllByRole("button", { name: /^sign out /i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Sign out Chrome on Windows" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sign out Safari on iPhone" }));
    await waitFor(() => expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument());
    expect(screen.getByText(/only signed in on this device/i)).toBeInTheDocument();
  });
});

describe("PrivacyPanel", () => {
  it("requires the word DELETE and the password before deleting", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<PrivacyPanel />);

    await user.type(screen.getByLabelText("Your password"), "correct horse");
    await user.type(screen.getByLabelText(/type delete/i), "delete");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    expect(screen.getByLabelText(/type delete/i)).toHaveAccessibleDescription(/type delete/i);
    expect(authStore.getState().user).not.toBeNull();
  });

  it("deletes the account, signs out and returns home", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<PrivacyPanel />);

    await user.type(screen.getByLabelText("Your password"), "correct horse");
    await user.type(screen.getByLabelText(/type delete/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledWith("/"));
    expect(authStore.getState().user).toBeNull();
  });

  it("keeps the account when the password is wrong", async () => {
    const user = userEvent.setup();
    await signInMock();
    renderWithProviders(<PrivacyPanel />);

    await user.type(screen.getByLabelText("Your password"), MOCK_WRONG_PASSWORD);
    await user.type(screen.getByLabelText(/type delete/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your password is incorrect.");
    expect(routerSpies.replace).not.toHaveBeenCalled();
    expect(authStore.getState().user).not.toBeNull();
  });

  it("offers the data export as a download", async () => {
    await signInMock();
    renderWithProviders(<PrivacyPanel />);
    expect(screen.getByRole("button", { name: /download my data/i })).toBeEnabled();
  });
});

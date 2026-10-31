import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { MOCK_RESET_TOKEN } from "@test/mocks/accounts";
import { renderWithProviders } from "./utils";

describe("<ResetPasswordForm>", () => {
  beforeEach(() => window.history.replaceState(null, "", "/reset-password"));

  it("explains a link that has no token", async () => {
    renderWithProviders(<ResetPasswordForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is incomplete.");
  });

  it("checks the two passwords match, then sets the new password from the link", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${MOCK_RESET_TOKEN}`);
    renderWithProviders(<ResetPasswordForm />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("New password"), "a brand new passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "something else entirely");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The passwords don't match.");

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Your password is updated")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
});

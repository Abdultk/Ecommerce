import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "@/lib/auth-store";
import { MOCK_WRONG_PASSWORD } from "@/test/msw/auth";
import { navigationMock, routerSpies } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { setupMockApi } from "@/test/server";
import { LoginForm } from "./LoginForm";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

describe("LoginForm", () => {
  beforeEach(() => {
    authStore.reset();
    routerSpies.push.mockClear();
  });

  it("shows field-level errors linked with aria-describedby and focuses the first one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const email = screen.getByLabelText(/email/i);
    const password = screen.getByLabelText(/password/i);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(password).toHaveAccessibleDescription("Enter your password.");
    expect(email).toHaveFocus();
  });

  it("clears an error once the field is corrected and resubmitted", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByLabelText(/email/i)).toHaveAccessibleDescription(
      "Enter a valid email address.",
    );

    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "ada@example.test");
    await user.type(screen.getByLabelText(/password/i), "correct horse");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(routerSpies.push).toHaveBeenCalledWith("/"));
    expect(screen.getByLabelText(/email/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("stores the session in memory only and redirects on success", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm redirectTo="/cart" />);

    await user.type(screen.getByLabelText(/email/i), "ada@example.test");
    await user.type(screen.getByLabelText(/password/i), "correct horse");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(routerSpies.push).toHaveBeenCalledWith("/cart"));
    expect(authStore.getState().user?.email).toBe("ada@example.test");
    expect(authStore.getToken()).toMatch(/^mock-access-/);
    expect(window.localStorage.length).toBe(0);
  });

  it("shows the server's message when credentials are wrong", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "ada@example.test");
    await user.type(screen.getByLabelText(/password/i), MOCK_WRONG_PASSWORD);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/i);
    expect(routerSpies.push).not.toHaveBeenCalled();
  });
});

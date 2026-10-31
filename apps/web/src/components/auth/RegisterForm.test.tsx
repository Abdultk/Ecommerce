import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "@/lib/auth-store";
import { navigationMock, routerSpies } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { API_URL, server, setupMockApi } from "@/test/server";
import { RegisterForm } from "./RegisterForm";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

async function fill(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(screen.getByLabelText("First name"), "Ada");
  await user.type(screen.getByLabelText("Last name"), "Cook");
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

describe("RegisterForm", () => {
  beforeEach(() => {
    authStore.reset();
    routerSpies.push.mockClear();
  });

  it("validates every field and keeps the password hint linked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterForm />);

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByLabelText("First name")).toHaveAccessibleDescription("Required.");
    expect(screen.getByLabelText("First name")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      /Use at least 12 characters\..*At least 12 characters/,
    );
  });

  it("rejects a short password before calling the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterForm />);
    await fill(user, "ada@example.test", "short");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(routerSpies.push).not.toHaveBeenCalled();
  });

  it("asks the customer to check their email and signs nobody in", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterForm />);
    await fill(user, "ada@example.test", "a long kitchen passphrase");

    expect(await screen.findByRole("status")).toHaveTextContent(/check ada@example\.test/i);
    expect(authStore.getState().user).toBeNull();
    expect(routerSpies.push).not.toHaveBeenCalled();
  });

  it("offers to resend the email", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterForm />);
    await fill(user, "ada@example.test", "a long kitchen passphrase");

    await user.click(await screen.findByRole("button", { name: /resend the email/i }));
    await waitFor(() =>
      expect(screen.getByText(/a new link is on its way/i)).toBeInTheDocument(),
    );
  });

  it("shows a generic message when the network fails", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API_URL}/auth/register`, () => HttpResponse.error()));
    renderWithProviders(<RegisterForm />);
    await fill(user, "ada@example.test", "a long kitchen passphrase");
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach the server/i);
  });
});

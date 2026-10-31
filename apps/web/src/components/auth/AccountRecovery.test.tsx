import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "@/lib/auth-store";
import { cartQueryKey } from "@/lib/cart";
import { MOCK_EXPIRED_TOKEN } from "@/test/msw/auth";
import { navigationMock, routerSpies } from "@/test/navigation";
import { renderWithProviders } from "@/test/render";
import { server, setupMockApi } from "@/test/server";
import { addToMockCart } from "@/test/session";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { VerifyEmail } from "./VerifyEmail";

vi.mock("next/navigation", () => navigationMock());
setupMockApi();

const TOKEN = "reset-token-1234567890abcdef";

beforeEach(() => {
  authStore.clear();
  routerSpies.push.mockClear();
  server.events.removeAllListeners();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("ForgotPasswordForm", () => {
  it("validates the email, then confirms without revealing whether the account exists", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ForgotPasswordForm />);
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Enter a valid email address.",
    );

    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/if an account exists/i);
  });
});

describe("ResetPasswordForm", () => {
  it("reads the token from the #fragment, strips it and resets the password", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.events.on("request:start", async ({ request }) => {
      if (request.url.endsWith("/auth/reset-password")) bodies.push(await request.clone().json());
    });
    window.history.replaceState(null, "", `/reset-password#token=${TOKEN}`);

    renderWithProviders(<ResetPasswordForm />);

    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    await user.type(await screen.findByLabelText("New password"), "a long kitchen passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a long kitchen passphrase");
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/password is reset/i);
    expect(bodies).toEqual([{ token: TOKEN, password: "a long kitchen passphrase" }]);
  });

  it("still accepts (and strips) a ?token= link from emails sent before the change", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.events.on("request:start", async ({ request }) => {
      if (request.url.endsWith("/auth/reset-password")) bodies.push(await request.clone().json());
    });
    window.history.replaceState(null, "", `/reset-password?token=${TOKEN}`);

    renderWithProviders(<ResetPasswordForm />);

    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    await user.type(await screen.findByLabelText("New password"), "a long kitchen passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a long kitchen passphrase");
    await user.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/password is reset/i);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    expect(bodies).toEqual([{ token: TOKEN, password: "a long kitchen passphrase" }]);
  });

  it("checks the password rules and that both entries match", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/reset-password?token=${TOKEN}`);
    renderWithProviders(<ResetPasswordForm />);

    await user.type(await screen.findByLabelText("New password"), "short");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /Use at least 12 characters\./,
    );

    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), "a long kitchen passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a different passphrase");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    expect(screen.getByLabelText("Confirm new password")).toHaveAccessibleDescription(
      "The passwords don't match.",
    );
  });

  it("shows the API's message for an expired link", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/reset-password?token=${MOCK_EXPIRED_TOKEN}`);
    renderWithProviders(<ResetPasswordForm />);
    await user.type(await screen.findByLabelText("New password"), "a long kitchen passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a long kitchen passphrase");
    await user.click(screen.getByRole("button", { name: /reset password/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
  });

  it("explains a missing token", async () => {
    window.history.replaceState(null, "", "/reset-password");
    renderWithProviders(<ResetPasswordForm />);
    expect(await screen.findByText(/link is incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});

describe("VerifyEmail", () => {
  it("verifies the token from the #fragment and strips it", async () => {
    window.history.replaceState(null, "", `/verify-email#token=${TOKEN}`);
    renderWithProviders(<VerifyEmail />);
    expect(window.location.href).not.toContain(TOKEN);
    expect(await screen.findByText(/email is verified/i)).toBeInTheDocument();
  });

  it("verifies a legacy ?token= link and strips it", async () => {
    window.history.replaceState(null, "", `/verify-email?token=${TOKEN}`);
    renderWithProviders(<VerifyEmail />);
    expect(window.location.href).not.toContain(TOKEN);
    expect(await screen.findByText(/email is verified/i)).toBeInTheDocument();
  });

  it("reports an expired link", async () => {
    window.history.replaceState(null, "", `/verify-email?token=${MOCK_EXPIRED_TOKEN}`);
    renderWithProviders(<VerifyEmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
  });

  it("explains a missing token", async () => {
    window.history.replaceState(null, "", "/verify-email");
    renderWithProviders(<VerifyEmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/link is incomplete/i);
  });
});

describe("cart merge after sign-in", () => {
  it("merges the guest cart right after a successful login", async () => {
    const user = userEvent.setup();
    await addToMockCart("v_sample_04_1", 1);
    const calls: string[] = [];
    server.events.on("request:start", ({ request }) => {
      if (request.url.endsWith("/cart/merge")) {
        calls.push(request.headers.get("authorization") ?? "none");
      }
    });
    const { client } = renderWithProviders(<LoginForm redirectTo="/cart" />);

    await user.type(screen.getByLabelText(/email/i), "ada@example.test");
    await user.type(screen.getByLabelText(/password/i), "correct horse");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(routerSpies.push).toHaveBeenCalledWith("/cart"));
    expect(calls).toEqual([expect.stringMatching(/^Bearer mock-access-/)]);
    expect(client.getQueryData(cartQueryKey(authStore.getState().user!.id))).toMatchObject({
      items: [expect.objectContaining({ variantId: "v_sample_04_1" })],
    });
    expect(screen.getByRole("link", { name: /forgot your password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});

describe("auth forms before hydration (D-08)", () => {
  it("post, so a submit before JavaScript loads never puts a password in the URL", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${TOKEN}`);
    const forms = [
      renderWithProviders(<LoginForm />),
      renderWithProviders(<RegisterForm />),
      renderWithProviders(<ForgotPasswordForm />),
      renderWithProviders(<ResetPasswordForm />),
    ];
    await screen.findByLabelText("New password");
    for (const { container } of forms) {
      expect(container.querySelector("form")).toHaveAttribute("method", "post");
    }
  });
});

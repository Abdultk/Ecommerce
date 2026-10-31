import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { TwoFactorForm } from "@/components/auth/TwoFactorForm";
import { useSession } from "@/lib/session";
import { MOCK_ACCOUNTS, MOCK_PASSWORD, MOCK_TOTP_CODE } from "@test/mocks/accounts";
import { mockRouter, navigation } from "./navigation";
import { renderWithProviders } from "./utils";

function SignedIn() {
  const { user } = useSession();
  return <p>Signed in as {user ? `${user.firstName} (${user.role})` : "nobody"}</p>;
}

function Routes() {
  const path = usePathname();
  if (path === "/login") return <LoginForm />;
  if (path === "/login/2fa") return <TwoFactorForm />;
  return <SignedIn />;
}

const account = (email: string) => {
  const found = MOCK_ACCOUNTS.find((a) => a.user.email === email);
  if (!found) throw new Error(`no mock account ${email}`);
  return found;
};
const enrolled = MOCK_ACCOUNTS.find((a) => a.enrolled && a.user.role === "STAFF")!;

async function signIn(email: string, password = MOCK_PASSWORD) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
}

describe("admin login and 2FA", () => {
  beforeEach(() => navigation.reset("/login"));

  it("posts the login form, so a submit before hydration never puts the password in the URL", () => {
    renderWithProviders(<Routes />, { bootstrap: false });
    const form = screen.getByRole("button", { name: "Continue" }).closest("form");
    expect(form).toHaveAttribute("method", "post");
  });

  it("signs an enrolled account in with password then TOTP code", async () => {
    renderWithProviders(<Routes />);
    const user = await signIn(enrolled.user.email);

    const code = await screen.findByLabelText("6-digit code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(mockRouter.push).toHaveBeenCalledWith("/login/2fa");
    expect(screen.queryByText(/QR code/)).not.toBeInTheDocument();

    await user.type(code, MOCK_TOTP_CODE);
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    expect(
      await screen.findByText(`Signed in as ${enrolled.user.firstName} (STAFF)`),
    ).toBeInTheDocument();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  it.each(["ADMIN", "SUPER_ADMIN"] as const)(
    "returns a %s session for that account",
    async (role) => {
      const target = MOCK_ACCOUNTS.find((a) => a.enrolled && a.user.role === role)!;
      renderWithProviders(<Routes />);
      const user = await signIn(target.user.email);
      await user.type(await screen.findByLabelText("6-digit code"), MOCK_TOTP_CODE);
      await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
      expect(
        await screen.findByText(`Signed in as ${target.user.firstName} (${role})`),
      ).toBeInTheDocument();
    },
  );

  it("keeps the user on the 2FA step when the code is wrong", async () => {
    renderWithProviders(<Routes />);
    const user = await signIn(enrolled.user.email);
    await user.type(await screen.findByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work. Check your authenticator app.",
    );
    expect(screen.getByLabelText("6-digit code")).toHaveValue("");
    expect(mockRouter.replace).not.toHaveBeenCalledWith("/");
  });

  it("rejects a code that is not six digits before calling the API", async () => {
    renderWithProviders(<Routes />);
    const user = await signIn(enrolled.user.email);
    await user.type(await screen.findByLabelText("6-digit code"), "12ab");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the 6-digit code");
  });

  it("shows a generic error for a wrong password", async () => {
    renderWithProviders(<Routes />);
    await signIn(account(enrolled.user.email).user.email, "wrong-password-123");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("shows the same generic error for an unknown email", async () => {
    renderWithProviders(<Routes />);
    await signIn("nobody@hearthandpan.test");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("sends a visitor without a pending challenge back to /login", async () => {
    navigation.reset("/login/2fa");
    renderWithProviders(<Routes />);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(mockRouter.replace).toHaveBeenCalledWith("/login");
  });
});

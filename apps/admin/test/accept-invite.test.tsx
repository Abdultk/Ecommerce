import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it } from "vitest";
import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import { LoginForm } from "@/components/auth/LoginForm";
import { TwoFactorForm } from "@/components/auth/TwoFactorForm";
import { useSession } from "@/lib/session";
import {
  MOCK_ACCOUNTS,
  MOCK_INVITE_TOKEN,
  MOCK_PASSWORD,
  MOCK_TOTP_CODE,
  MOCK_TOTP_SECRET,
} from "@test/mocks/accounts";
import { mockRouter, navigation } from "./navigation";
import { API, server } from "./server";
import { renderWithProviders } from "./utils";

const NEW_PASSWORD = "copper-pans-and-cast-iron";
const invited = MOCK_ACCOUNTS.find((a) => !a.enrolled)!;

function SignedIn() {
  const { user } = useSession();
  return <p>Signed in as {user ? `${user.firstName} (${user.role})` : "nobody"}</p>;
}

function Routes() {
  const path = usePathname();
  if (path === "/accept-invite") return <AcceptInviteForm />;
  if (path === "/login") return <LoginForm />;
  if (path === "/login/2fa") return <TwoFactorForm />;
  return <SignedIn />;
}

function openInviteLink(hash: string) {
  window.history.replaceState(null, "", `/accept-invite${hash}`);
  navigation.reset("/accept-invite");
}

async function setPassword(password = NEW_PASSWORD, confirm = password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
  await user.click(screen.getByRole("button", { name: "Set password" }));
  return user;
}

describe("accept invite", () => {
  beforeEach(() => openInviteLink(`#token=${MOCK_INVITE_TOKEN}`));

  it("posts the password form, so a submit before hydration never puts it in the URL", async () => {
    renderWithProviders(<Routes />, { bootstrap: false });
    const button = await screen.findByRole("button", { name: "Set password" });
    expect(button.closest("form")).toHaveAttribute("method", "post");
  });

  it("removes the token from the address bar as soon as the page loads", async () => {
    renderWithProviders(<Routes />);
    await screen.findByLabelText("New password");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(MOCK_INVITE_TOKEN);
  });

  it("enrolls with a scannable QR code and the manual secret, then signs in", async () => {
    let sentBody: unknown = null;
    server.use(
      http.post(`${API}/admin/auth/accept-invite`, async ({ request }) => {
        sentBody = await request.clone().json();
      }),
    );
    renderWithProviders(<Routes />);
    const user = await setPassword();

    expect(sentBody).toEqual({ token: MOCK_INVITE_TOKEN, password: NEW_PASSWORD });
    expect(mockRouter.push).toHaveBeenCalledWith("/login/2fa");

    const qr = await screen.findByRole("img", { name: /QR code/ });
    expect(qr.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText(MOCK_TOTP_SECRET)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy secret" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("6-digit code"), MOCK_TOTP_CODE);
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(
      await screen.findByText(`Signed in as ${invited.user.firstName} (ADMIN)`),
    ).toBeInTheDocument();
  });

  it("checks the password rules and the confirmation before calling the API", async () => {
    renderWithProviders(<Routes />);
    await setPassword("short");
    expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 12 characters.");

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm password"));
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.type(screen.getByLabelText("Confirm password"), `${NEW_PASSWORD}x`);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The passwords don't match.");
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("explains an expired or used link", async () => {
    openInviteLink("#token=mock-invite-token-already-used-0000");
    renderWithProviders(<Routes />);
    await setPassword();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link has expired or was already used.",
    );
  });

  it("asks for a fresh link when the URL has no token", async () => {
    openInviteLink("");
    renderWithProviders(<Routes />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite link is incomplete");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });
});

describe("login before enrollment", () => {
  beforeEach(() => navigation.reset("/login"));

  it("shows the API's 403 and stays on the password step", async () => {
    renderWithProviders(<Routes />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), invited.user.email);
    await user.type(screen.getByLabelText("Password"), MOCK_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Finish setting up your account with the link in your invite email.",
    );
    await waitFor(() => expect(mockRouter.push).not.toHaveBeenCalled());
  });
});

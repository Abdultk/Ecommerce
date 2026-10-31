import { PublicUser, type AuthSession, type Role } from "@hp/contracts";

// ---------------------------------------------------------------------------
// LOCAL MOCK VALUES ONLY. These accounts, the password and the TOTP code exist
// solely for MSW mock mode (NEXT_PUBLIC_API_MOCKING=enabled) and tests. They
// are not real credentials and never reach a real API. Keep them in test/mocks.
// ---------------------------------------------------------------------------

export const MOCK_PASSWORD = "mock-password-local-only";
export const MOCK_TOTP_CODE = "123456";
/** Well-known demo base32 secret used in TOTP documentation; mock only. */
export const MOCK_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

/**
 * MOCK VALUE: the pending invite for new.admin@hearthandpan.test. Open
 * /accept-invite?token=mock-invite-token-local-only-0001 in mock mode to enroll
 * that account (any password of 12+ characters, then TOTP code 123456).
 * The real API emails a random single-use token instead.
 */
export const MOCK_INVITE_TOKEN = "mock-invite-token-local-only-0001";

/**
 * MOCK VALUE: an unused password-reset link for staff@hearthandpan.test. Open
 * /reset-password#token=mock-reset-token-local-only-0001 in mock mode and choose any
 * password of 12+ characters, then sign in with it and TOTP code 123456 (2FA stays
 * enrolled). Admins never see passwords: "Send password reset" on the Customers/Staff
 * pages issues a new link like this one, which the real API emails.
 */
export const MOCK_RESET_TOKEN = "mock-reset-token-local-only-0001";

export type MockAccount = {
  user: PublicUser;
  /**
   * False = 2FA not enrolled yet. Password login is refused with 403 until the
   * account is enrolled through its invite link (MOCK_INVITE_TOKEN).
   */
  enrolled: boolean;
};

const account = (
  id: string,
  email: string,
  firstName: string,
  lastName: string,
  role: Exclude<Role, "CUSTOMER">,
  enrolled = true,
): MockAccount => ({
  user: PublicUser.parse({ id, email, firstName, lastName, role, emailVerified: true }),
  enrolled,
});

export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  account("u_mock_staff", "staff@hearthandpan.test", "Sam", "Ortiz", "STAFF"),
  account("u_mock_admin", "admin@hearthandpan.test", "Priya", "Nair", "ADMIN"),
  account("u_mock_owner", "owner@hearthandpan.test", "Morgan", "Hale", "SUPER_ADMIN"),
  account("u_mock_new_admin", "new.admin@hearthandpan.test", "Jordan", "Reyes", "ADMIN", false),
];

export function otpauthUrlFor(email: string): string {
  const issuer = encodeURIComponent("Hearth & Pan Admin");
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${MOCK_TOTP_SECRET}&issuer=${issuer}`;
}

const TOKEN_PREFIX = "mock-access";
let tokenCounter = 0;

export function issueMockAccessToken(userId: string): string {
  tokenCounter += 1;
  return `${TOKEN_PREFIX}.${userId}.${tokenCounter}`;
}

/** The user id a mock access token was issued to, or null for anything else. */
export function userIdForToken(token: string | null): string | null {
  if (!token) return null;
  const [prefix, userId] = token.split(".");
  return prefix === TOKEN_PREFIX && userId ? userId : null;
}

/** A ready-made signed-in session for tests and mock mode. */
export function mockSessionFor(role: Exclude<Role, "CUSTOMER">): AuthSession {
  const found = MOCK_ACCOUNTS.find((a) => a.enrolled && a.user.role === role);
  if (!found) throw new Error(`No mock account for ${role}`);
  return { accessToken: issueMockAccessToken(found.user.id), user: found.user };
}

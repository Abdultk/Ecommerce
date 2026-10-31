import { http } from "msw";
import {
  AcceptInviteInput,
  Admin2faInput,
  AdminChallenge,
  AdminLoginInput,
  AuthSession,
  isAdminRole,
} from "@hp/contracts";
import { MOCK_TOTP_CODE, issueMockAccessToken, otpauthUrlFor } from "../accounts";
import { errorResponse, invalid, okResponse, readJson, type MockContext } from "../http";
import type { MockUser } from "../types";

const BAD_CREDENTIALS = "Email or password is incorrect.";
const BAD_CODE = "That code didn't work. Check your authenticator app.";
export const UNENROLLED_MESSAGE =
  "Finish setting up your account with the link in your invite email.";
const BAD_INVITE = "This link has expired or was already used.";

const sessionFor = (u: MockUser) =>
  okResponse(AuthSession.parse({ accessToken: issueMockAccessToken(u.user.id), user: u.user }));

export function authRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  const challengeFor = (userId: string, enrolling: boolean) => {
    const token = ctx.nextId("challenge");
    store.update((db) => ({
      ...db,
      challenges: [...db.challenges, { token, userId, enrolling }],
    }));
    return token;
  };

  return [
    http.post(`${baseUrl}/admin/auth/login`, async ({ request }) => {
      const input = AdminLoginInput.safeParse(await readJson(request));
      if (!input.success)
        return errorResponse("VALIDATION_ERROR", "Enter your email and password.");
      const found = store.get().users.find((u) => u.user.email === input.data.email);
      // Same answer for unknown email, wrong password, disabled or non-staff accounts.
      if (
        !found ||
        found.disabled ||
        !isAdminRole(found.user.role) ||
        found.password === null ||
        found.password !== input.data.password
      ) {
        return errorResponse("UNAUTHENTICATED", BAD_CREDENTIALS);
      }
      if (!found.twoFactorEnabled) return errorResponse("FORBIDDEN", UNENROLLED_MESSAGE);
      const challengeToken = challengeFor(found.user.id, false);
      return okResponse(AdminChallenge.parse({ challengeToken, enrollmentRequired: false }));
    }),

    http.post(`${baseUrl}/admin/auth/accept-invite`, async ({ request }) => {
      const input = AcceptInviteInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const invite = store.get().invites.find((i) => i.token === input.data.token);
      const invited = store.get().users.find((u) => u.user.id === invite?.userId);
      if (!invite || !invited || invited.disabled)
        return errorResponse("VALIDATION_ERROR", BAD_INVITE);

      store.update((db) => ({
        ...db,
        invites: db.invites.filter((i) => i.token !== invite.token),
        users: db.users.map((u) =>
          u.user.id === invited.user.id ? { ...u, password: input.data.password } : u,
        ),
      }));
      const challengeToken = challengeFor(invited.user.id, true);
      return okResponse(
        AdminChallenge.parse({
          challengeToken,
          enrollmentRequired: true,
          otpauthUrl: otpauthUrlFor(invited.user.email),
        }),
      );
    }),

    http.post(`${baseUrl}/admin/auth/2fa`, async ({ request }) => {
      const input = Admin2faInput.safeParse(await readJson(request));
      if (!input.success) return errorResponse("VALIDATION_ERROR", BAD_CODE);
      const challenge = store.get().challenges.find((c) => c.token === input.data.challengeToken);
      if (!challenge)
        return errorResponse("UNAUTHENTICATED", "Your sign-in expired. Please start again.");
      if (input.data.code !== MOCK_TOTP_CODE) return errorResponse("UNAUTHENTICATED", BAD_CODE);

      const now = ctx.now();
      const db = store.update((current) => ({
        ...current,
        challenges: current.challenges.filter((c) => c.token !== challenge.token),
        refreshUserId: challenge.userId,
        users: current.users.map((u) =>
          u.user.id === challenge.userId
            ? {
                ...u,
                lastLoginAt: now,
                twoFactorEnabled: u.twoFactorEnabled || challenge.enrolling,
              }
            : u,
        ),
      }));
      const user = db.users.find((u) => u.user.id === challenge.userId);
      if (!user)
        return errorResponse("UNAUTHENTICATED", "Your sign-in expired. Please start again.");
      return sessionFor(user);
    }),

    http.post(`${baseUrl}/auth/refresh`, () => {
      const db = store.get();
      const holder = db.users.find((u) => u.user.id === db.refreshUserId && !u.disabled);
      if (!holder)
        return errorResponse("UNAUTHENTICATED", "Your session has ended. Sign in again.");
      return sessionFor(holder);
    }),

    http.post(`${baseUrl}/auth/logout`, () => {
      store.update((db) => ({ ...db, refreshUserId: null }));
      return okResponse(null);
    }),
  ];
}

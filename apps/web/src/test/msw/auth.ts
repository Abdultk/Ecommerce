import { http, HttpResponse } from "msw";
import {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ok,
  type AuthSession,
  type PublicUser,
} from "@hp/contracts";
import { MOCK_USER_ID } from "./seed";
import { errorResponse, readJson, type MockStore } from "./state";

// App-local auth mock until the API's /auth endpoints pass integration tests.
// Every success body is a contract-valid AuthSession envelope.

/** Signing in with this password simulates wrong credentials. */
export const MOCK_WRONG_PASSWORD = "wrong-password";
/** Reset and verify links carrying this token behave as expired. */
export const MOCK_EXPIRED_TOKEN = "expired-token-0000000000";

const mockUser = (email: string, firstName = "Ada", lastName = "Cook"): PublicUser => ({
  id: MOCK_USER_ID,
  email,
  firstName,
  lastName,
  role: "CUSTOMER",
  emailVerified: true,
});

let tokenSequence = 0;
const session = (user: PublicUser): AuthSession => ({
  accessToken: `mock-access-${++tokenSequence}`,
  user,
});

const EXPIRED_LINK = "This link is invalid or has expired. Request a new one.";

export function createAuthHandlers(store: MockStore) {
  // The refresh cookie is simulated by remembering the signed-in user per handler set.
  const { baseUrl } = store;
  const setUser = (user: PublicUser | null) => store.update((s) => ({ ...s, user }));

  return [
    http.post(`${baseUrl}/auth/login`, async ({ request }) => {
      const parsed = LoginInput.safeParse(await readJson(request));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      if (parsed.data.password === MOCK_WRONG_PASSWORD) {
        return errorResponse("UNAUTHENTICATED", "That email and password don't match.");
      }
      const user = setUser(mockUser(parsed.data.email)).user!;
      return HttpResponse.json(ok(session(user)));
    }),

    http.post(`${baseUrl}/auth/register`, async ({ request }) => {
      const parsed = RegisterInput.safeParse(await readJson(request));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      // Same 202 for a new and a taken email, and no session: the API never reveals which.
      return HttpResponse.json(ok(null), { status: 202 });
    }),

    http.post(`${baseUrl}/auth/resend-verification`, () =>
      HttpResponse.json(ok(null), { status: 202 }),
    ),

    http.post(`${baseUrl}/auth/refresh`, () => {
      const user = store.get().user;
      return user
        ? HttpResponse.json(ok(session(user)))
        : errorResponse("UNAUTHENTICATED", "Your session has ended. Please sign in again.");
    }),

    http.post(`${baseUrl}/auth/logout`, () => {
      setUser(null);
      return HttpResponse.json(ok(null));
    }),

    // Always 202, whether or not the account exists, so the form can't probe for emails.
    http.post(`${baseUrl}/auth/forgot-password`, async ({ request }) => {
      const parsed = ForgotPasswordInput.safeParse(await readJson(request));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      return HttpResponse.json(ok(null), { status: 202 });
    }),

    http.post(`${baseUrl}/auth/reset-password`, async ({ request }) => {
      const parsed = ResetPasswordInput.safeParse(await readJson(request));
      if (!parsed.success) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          parsed.error.flatten().fieldErrors,
        );
      }
      if (parsed.data.token === MOCK_EXPIRED_TOKEN) {
        return errorResponse("VALIDATION_ERROR", EXPIRED_LINK);
      }
      return HttpResponse.json(ok(null));
    }),

    http.post(`${baseUrl}/auth/verify-email`, async ({ request }) => {
      const parsed = VerifyEmailInput.safeParse(await readJson(request));
      if (!parsed.success || parsed.data.token === MOCK_EXPIRED_TOKEN) {
        return errorResponse("VALIDATION_ERROR", EXPIRED_LINK);
      }
      store.update((s) => (s.user ? { ...s, user: { ...s.user, emailVerified: true } } : s));
      return HttpResponse.json(ok(null));
    }),
  ];
}

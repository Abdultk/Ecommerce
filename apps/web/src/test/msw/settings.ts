import { http, HttpResponse } from "msw";
import {
  CustomerChangePasswordInput,
  CustomerPreferencesUpdate,
  DeleteAccountInput,
  ok,
  type AccountSession,
  type CustomerPreferences,
  type PublicUser,
} from "@hp/contracts";
import { MOCK_WRONG_PASSWORD } from "./auth";
import {
  errorResponse,
  readJson,
  requestUser,
  unauthenticated,
  validationError,
  type MockStore,
} from "./state";

const NO_PREFERENCES: CustomerPreferences = {
  phone: null,
  marketingEmails: false,
  shippingUpdateEmails: true,
  preferredPayment: null,
  preferredShipping: null,
  updatedAt: null,
};

const DEVICES: readonly AccountSession[] = [
  {
    id: "session_mock_current",
    device: "Chrome on Windows",
    signedInAt: "2026-10-01T08:00:00.000Z",
    expiresAt: "2026-10-31T08:00:00.000Z",
    current: true,
  },
  {
    id: "session_mock_phone",
    device: "Safari on iPhone",
    signedInAt: "2026-10-10T19:30:00.000Z",
    expiresAt: "2026-11-09T19:30:00.000Z",
    current: false,
  },
];

type Args = { request: Request; params: Record<string, unknown> };

export function createSettingsHandlers(store: MockStore) {
  const { baseUrl } = store;
  let preferences = NO_PREFERENCES;
  let sessions = DEVICES;

  const authed =
    <R>(handler: (args: Args, user: PublicUser) => R) =>
    (args: Args) => {
      const user = requestUser(args.request, store);
      return user ? handler(args, user) : unauthenticated();
    };

  return [
    http.get(
      `${baseUrl}/me/preferences`,
      authed(() => HttpResponse.json(ok(preferences))),
    ),

    http.put(
      `${baseUrl}/me/preferences`,
      authed(async ({ request }) => {
        const parsed = CustomerPreferencesUpdate.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        preferences = { ...preferences, ...parsed.data, updatedAt: new Date().toISOString() };
        return HttpResponse.json(ok(preferences));
      }),
    ),

    http.post(
      `${baseUrl}/me/password`,
      authed(async ({ request }) => {
        const parsed = CustomerChangePasswordInput.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        if (parsed.data.currentPassword === MOCK_WRONG_PASSWORD) {
          return errorResponse("VALIDATION_ERROR", "Your password is incorrect.");
        }
        sessions = sessions.filter((s) => s.current);
        return HttpResponse.json(ok(null));
      }),
    ),

    http.get(
      `${baseUrl}/me/sessions`,
      authed(() => HttpResponse.json(ok(sessions))),
    ),

    http.post(
      `${baseUrl}/me/sessions/revoke-others`,
      authed(() => {
        sessions = sessions.filter((s) => s.current);
        return HttpResponse.json(ok(null));
      }),
    ),

    http.delete(
      `${baseUrl}/me/sessions/:id`,
      authed(({ params }) => {
        const target = sessions.find((s) => s.id === params.id);
        if (!target) return errorResponse("NOT_FOUND", "Device not found.");
        if (target.current) {
          return errorResponse(
            "CONFLICT",
            "That's the device you're using. Sign out from the menu instead.",
          );
        }
        sessions = sessions.filter((s) => s.id !== target.id);
        return HttpResponse.json(ok(null));
      }),
    ),

    http.get(
      `${baseUrl}/me/export`,
      authed((_args, user) =>
        HttpResponse.json(
          ok({
            exportedAt: new Date().toISOString(),
            account: { email: user.email, firstName: user.firstName, lastName: user.lastName },
            preferences,
            addresses: store.get().addresses,
            wishlist: store.get().wishlist,
            orders: [],
            reviews: [],
          }),
        ),
      ),
    ),

    http.post(
      `${baseUrl}/me/delete`,
      authed(async ({ request }) => {
        const parsed = DeleteAccountInput.safeParse(await readJson(request));
        if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
        if (parsed.data.password === MOCK_WRONG_PASSWORD) {
          return errorResponse("VALIDATION_ERROR", "Your password is incorrect.");
        }
        store.update((s) => ({ ...s, user: null }));
        return HttpResponse.json(ok(null));
      }),
    ),
  ];
}

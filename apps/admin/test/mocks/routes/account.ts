import { http } from "msw";
import {
  AdminProfile,
  AdminResetPasswordInput,
  ChangePasswordInput,
  ProfileUpdate,
  isAdminRole,
} from "@hp/contracts";
import { MOCK_TOTP_CODE } from "../accounts";
import {
  authenticate,
  errorResponse,
  invalid,
  okResponse,
  readJson,
  withAudit,
  type MockContext,
} from "../http";
import type { MockDb, MockUser } from "../types";

// Mirrors the Phase 3b admin profile and staff reset-password endpoints (§5, §6).

const BAD_LINK =
  "This reset link has expired or was already used. Ask a super admin for a new one.";
const WRONG_CURRENT = "Your current password or 2FA code is incorrect.";

export function toAdminProfile(u: MockUser): AdminProfile {
  return AdminProfile.parse({
    ...u.user,
    totpEnabledAt: u.twoFactorEnabled ? u.createdAt : null,
  });
}

const withUser = (db: MockDb, next: MockUser): MockDb => ({
  ...db,
  users: db.users.map((u) => (u.user.id === next.user.id ? next : u)),
});

export function accountRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  const audited = (caller: MockUser, action: string, db: MockDb, after: unknown = null) =>
    withAudit(ctx, db, {
      actor: caller,
      action,
      entity: "User",
      entityId: caller.user.id,
      before: null,
      after,
    });

  return [
    http.get(`${baseUrl}/admin/me`, ({ request }) => {
      const caller = authenticate(ctx, request);
      if (caller instanceof Response) return caller;
      return okResponse(toAdminProfile(caller));
    }),

    http.patch(`${baseUrl}/admin/me`, async ({ request }) => {
      const caller = authenticate(ctx, request);
      if (caller instanceof Response) return caller;
      const input = ProfileUpdate.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const next: MockUser = { ...caller, user: { ...caller.user, ...input.data } };
      store.update((db) => audited(caller, "user.profile_update", withUser(db, next), input.data));
      return okResponse(toAdminProfile(next));
    }),

    http.post(`${baseUrl}/admin/me/password`, async ({ request }) => {
      const caller = authenticate(ctx, request);
      if (caller instanceof Response) return caller;
      const input = ChangePasswordInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const { currentPassword, newPassword, totpCode } = input.data;
      if (caller.password !== currentPassword || totpCode !== MOCK_TOTP_CODE) {
        return errorResponse("UNAUTHENTICATED", WRONG_CURRENT);
      }
      const next: MockUser = { ...caller, password: newPassword };
      store.update((db) => audited(caller, "user.password_change", withUser(db, next)));
      return okResponse(null);
    }),

    // The mock keeps one refresh "cookie" (this tab), so other sessions are already gone.
    http.post(`${baseUrl}/admin/me/sessions/revoke-others`, ({ request }) => {
      const caller = authenticate(ctx, request);
      if (caller instanceof Response) return caller;
      store.update((db) => audited(caller, "user.sessions_revoke_others", db));
      return okResponse(null);
    }),

    http.post(`${baseUrl}/admin/auth/reset-password`, async ({ request }) => {
      const input = AdminResetPasswordInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const db = store.get();
      const link = db.resetTokens.find((t) => t.token === input.data.token);
      const target = db.users.find((u) => u.user.id === link?.userId);
      // Customer links are refused here; they belong to the storefront.
      if (!link || !target || target.disabled || !isAdminRole(target.user.role)) {
        return errorResponse("VALIDATION_ERROR", BAD_LINK);
      }
      store.update((current) => ({
        ...withUser(current, { ...target, password: input.data.password }),
        resetTokens: current.resetTokens.filter((t) => t.userId !== target.user.id),
        refreshUserId: current.refreshUserId === target.user.id ? null : current.refreshUserId,
      }));
      return okResponse(null);
    }),
  ];
}

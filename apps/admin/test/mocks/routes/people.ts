import { http } from "msw";
import {
  AdminInviteInput,
  AdminPasswordResetInput,
  PasswordResetSent,
  AdminUserQuery,
  AdminUserUpdate,
  AuditLogQuery,
  PublicUser,
  isAdminRole,
  type AdminUserListItem,
} from "@hp/contracts";
import {
  authorize,
  errorResponse,
  invalid,
  okResponse,
  pagedResponse,
  queryOf,
  readJson,
  withAudit,
  type MockContext,
} from "../http";
import type { MockDb, MockUser } from "../types";

// Mirrors apps/api/src/modules/admin/users.admin.ts (users and the audit log).

export function toUserListItem(u: MockUser, db: Pick<MockDb, "orders">): AdminUserListItem {
  return {
    id: u.user.id,
    email: u.user.email,
    firstName: u.user.firstName,
    lastName: u.user.lastName,
    role: u.user.role,
    disabled: u.disabled,
    emailVerified: u.user.emailVerified,
    twoFactorEnabled: u.twoFactorEnabled,
    orderCount: db.orders.filter((o) => o.customerId === u.user.id && o.order.paidAt).length,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

const access = (u: MockUser) => ({ role: u.user.role, disabled: u.disabled });

function losesLastSuperAdmin(db: MockDb, target: MockUser, update: AdminUserUpdate): boolean {
  const losesSuperAdmin =
    target.user.role === "SUPER_ADMIN" &&
    !target.disabled &&
    (update.disabled === true || (update.role !== undefined && update.role !== "SUPER_ADMIN"));
  if (!losesSuperAdmin) return false;
  return !db.users.some(
    (u) => u.user.role === "SUPER_ADMIN" && !u.disabled && u.user.id !== target.user.id,
  );
}

/** Who may reset whose password: never yourself; staff targets need SUPER_ADMIN. */
function resetRefusal(caller: MockUser, target: MockUser, resetTwoFactor: boolean) {
  if (caller.user.id === target.user.id) {
    return errorResponse("FORBIDDEN", "Change your own password on your profile page.");
  }
  const staffTarget = isAdminRole(target.user.role);
  if (staffTarget && caller.user.role !== "SUPER_ADMIN") {
    return errorResponse("FORBIDDEN", "Only a super admin can reset a staff password.");
  }
  if (resetTwoFactor && !staffTarget) {
    return errorResponse("VALIDATION_ERROR", "Two-factor reset is only for staff accounts.");
  }
  return null;
}

export function peopleRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  /** Voids earlier invites and un-enrolls the account, like createAdminInvite in the API. */
  const startInvite = (db: MockDb, userId: string): MockDb => ({
    ...db,
    invites: [
      ...db.invites.filter((i) => i.userId !== userId),
      { token: `mock-invite-token-${ctx.nextId("inv")}`, userId },
    ],
    users: db.users.map((u) =>
      u.user.id === userId ? { ...u, password: null, twoFactorEnabled: false } : u,
    ),
    refreshUserId: db.refreshUserId === userId ? null : db.refreshUserId,
  });

  const userById = (db: MockDb, id: unknown) => db.users.find((u) => u.user.id === id);

  /** Voids earlier unused links, issues a new one and ends all the target's sessions. */
  const withResetLink = (db: MockDb, userId: string): MockDb => ({
    ...db,
    resetTokens: [
      ...db.resetTokens.filter((t) => t.userId !== userId),
      { token: `mock-reset-token-${ctx.nextId("rst")}`, userId },
    ],
    refreshUserId: db.refreshUserId === userId ? null : db.refreshUserId,
  });

  return [
    http.get(`${baseUrl}/admin/users`, ({ request }) => {
      const caller = authorize(ctx, request, "user:read");
      if (caller instanceof Response) return caller;
      const query = AdminUserQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const db = store.get();
      const term = query.data.q?.toLowerCase();
      const rows = db.users
        .filter(
          (u) =>
            (!query.data.role || u.user.role === query.data.role) &&
            (!term ||
              [u.user.email, u.user.firstName, u.user.lastName].some((s) =>
                s.toLowerCase().includes(term),
              )),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((u) => toUserListItem(u, db));
      return pagedResponse(rows, query.data.page, query.data.pageSize);
    }),

    http.patch(`${baseUrl}/admin/users/:id`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "user:write");
      if (caller instanceof Response) return caller;
      const input = AdminUserUpdate.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      if (params.id === caller.user.id) {
        return errorResponse("FORBIDDEN", "You can't change your own role or access.");
      }
      const before = userById(store.get(), params.id);
      if (!before) return errorResponse("NOT_FOUND", "User not found.");
      if (losesLastSuperAdmin(store.get(), before, input.data)) {
        return errorResponse("CONFLICT", "The store needs at least one active super admin.");
      }
      const { role, disabled } = input.data;
      const after: MockUser = {
        ...before,
        user: role ? { ...before.user, role } : before.user,
        disabled: disabled ?? before.disabled,
        twoFactorEnabled: role === "CUSTOMER" ? false : before.twoFactorEnabled,
      };
      const db = store.update((current) =>
        withAudit(
          ctx,
          {
            ...current,
            users: current.users.map((u) => (u.user.id === after.user.id ? after : u)),
            // Any change of access ends existing sessions.
            refreshUserId: current.refreshUserId === after.user.id ? null : current.refreshUserId,
          },
          {
            actor: caller,
            action: "user.update",
            entity: "User",
            entityId: after.user.id,
            before: access(before),
            after: access(after),
          },
        ),
      );
      return okResponse(toUserListItem(after, db));
    }),

    http.post(`${baseUrl}/admin/users/invite`, async ({ request }) => {
      const caller = authorize(ctx, request, "user:write");
      if (caller instanceof Response) return caller;
      const input = AdminInviteInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      if (store.get().users.some((u) => u.user.email === input.data.email)) {
        return errorResponse(
          "CONFLICT",
          "An account with that email already exists. Change its role instead.",
        );
      }
      const created: MockUser = {
        user: PublicUser.parse({ ...input.data, id: ctx.nextId("usr"), emailVerified: false }),
        disabled: false,
        twoFactorEnabled: false,
        password: null,
        createdAt: ctx.now(),
        lastLoginAt: null,
      };
      const db = store.update((current) =>
        withAudit(
          ctx,
          startInvite({ ...current, users: [...current.users, created] }, created.user.id),
          {
            actor: caller,
            action: "user.invite",
            entity: "User",
            entityId: created.user.id,
            before: null,
            after: { email: created.user.email, role: created.user.role },
          },
        ),
      );
      return okResponse(toUserListItem(created, db), 201);
    }),

    // Resends an invite, e.g. after a lost phone: resets the password and 2FA enrollment.
    http.post(`${baseUrl}/admin/users/:id/invite`, ({ request, params }) => {
      const caller = authorize(ctx, request, "user:write");
      if (caller instanceof Response) return caller;
      if (params.id === caller.user.id) {
        return errorResponse("FORBIDDEN", "Ask another super admin to reset your access.");
      }
      const target = userById(store.get(), params.id);
      if (!target) return errorResponse("NOT_FOUND", "User not found.");
      if (!isAdminRole(target.user.role) || target.disabled) {
        return errorResponse("CONFLICT", "Only active staff accounts can be sent an invite.");
      }
      const db = store.update((current) =>
        withAudit(ctx, startInvite(current, target.user.id), {
          actor: caller,
          action: "user.reinvite",
          entity: "User",
          entityId: target.user.id,
          before: null,
          after: null,
        }),
      );
      return okResponse(toUserListItem(userById(db, target.user.id)!, db));
    }),

    // Sends a reset link; admins never see or set the password (docs/phase-3b-oman.md §5).
    http.post(`${baseUrl}/admin/users/:id/password-reset`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "user:reset-password");
      if (caller instanceof Response) return caller;
      const input = AdminPasswordResetInput.safeParse((await readJson(request)) ?? {});
      if (!input.success) return invalid(input.error);
      const target = userById(store.get(), params.id);
      if (!target) return errorResponse("NOT_FOUND", "User not found.");
      const refusal = resetRefusal(caller, target, input.data.resetTwoFactor === true);
      if (refusal) return refusal;
      const reinvite = input.data.resetTwoFactor === true;
      store.update((current) =>
        withAudit(
          ctx,
          reinvite ? startInvite(current, target.user.id) : withResetLink(current, target.user.id),
          {
            actor: caller,
            action: "user.password_reset_sent",
            entity: "User",
            entityId: target.user.id,
            before: null,
            after: { resetTwoFactor: reinvite },
          },
        ),
      );
      return okResponse(PasswordResetSent.parse({ sent: true }), 202);
    }),

    http.get(`${baseUrl}/admin/audit-log`, ({ request }) => {
      const caller = authorize(ctx, request, "audit:read");
      if (caller instanceof Response) return caller;
      const query = AuditLogQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const { entity, actorId, page, pageSize } = query.data;
      const rows = store
        .get()
        .audit.filter(
          (a) => (!entity || a.entity === entity) && (!actorId || a.actorId === actorId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return pagedResponse(rows, page, pageSize);
    }),
  ];
}

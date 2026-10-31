import { Router } from "express";
import { safeErrorFields } from "../../lib/safe-error";
import type { Prisma, User } from "@prisma/client";
import {
  AdminInviteInput,
  AdminUserQuery,
  AdminUserUpdate,
  AuditLogQuery,
  isAdminRole,
  ok,
  paged,
  type AdminUserListItem,
  type AuditLogEntry,
} from "@hp/contracts";
import { randomToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { pathParam } from "../../lib/params";
import { logger } from "../../lib/logger";
import type { Mailer } from "../../lib/mailer";
import { prisma, type DbClient } from "../../lib/prisma";
import { requirePermission } from "../../middleware/authenticate";
import { hashPassword } from "../auth/auth.service";
import { createAdminInvite, sendInviteEmail } from "../auth/invites";
import { revokeAllSessions } from "../auth/session";
import { audit } from "./audit";

type UserWithCount = User & { _count: { orders: number } };

const PAID_ORDERS = { orders: { where: { paidAt: { not: null } } } } as const;

const toListItem = (u: UserWithCount): AdminUserListItem => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role,
  disabled: u.disabledAt !== null,
  emailVerified: u.emailVerifiedAt !== null,
  twoFactorEnabled: u.totpEnabledAt !== null,
  orderCount: u._count.orders,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
});

const accessSnapshot = (u: User) => ({ role: u.role, disabled: u.disabledAt !== null });

async function loadUser(db: DbClient, id: string): Promise<UserWithCount> {
  const user = await db.user.findUnique({
    where: { id },
    include: { _count: { select: PAID_ORDERS } },
  });
  if (!user) throw new AppError("NOT_FOUND", "User not found.");
  return user;
}

/** Refuses any change that would leave the store without an active SUPER_ADMIN. */
async function assertNotLastSuperAdmin(tx: DbClient, target: User, update: AdminUserUpdate) {
  const losesSuperAdmin =
    target.role === "SUPER_ADMIN" &&
    !target.disabledAt &&
    (update.disabled === true || (update.role !== undefined && update.role !== "SUPER_ADMIN"));
  if (!losesSuperAdmin) return;
  // Lock every super admin row so two concurrent demotions can't both pass the count.
  await tx.$queryRaw`SELECT id FROM "User" WHERE "role" = 'SUPER_ADMIN' FOR UPDATE`;
  const others = await tx.user.count({
    where: { role: "SUPER_ADMIN", disabledAt: null, id: { not: target.id } },
  });
  if (others === 0) {
    throw new AppError("CONFLICT", "The store needs at least one active super admin.");
  }
}

/** /admin/users: customers and staff. */
export function usersAdminRouter(mailer: Mailer): Router {
  const router = Router();
  const write = requirePermission("user:write");

  const emailInvite = async (user: Pick<User, "email" | "firstName">, token: string) => {
    try {
      await sendInviteEmail(mailer, user, token);
    } catch (err) {
      logger.error({ err: safeErrorFields(err) }, "could not send staff invite");
      throw new AppError(
        "INTERNAL",
        "The invite was created but the email could not be sent. Try resending it.",
      );
    }
  };

  router.get("/", requirePermission("user:read"), async (req, res) => {
    const query = AdminUserQuery.parse(req.query);
    const where: Prisma.UserWhereInput = {
      ...(query.role && { role: query.role }),
      ...(query.q && {
        OR: [
          { email: { contains: query.q, mode: "insensitive" } },
          { firstName: { contains: query.q, mode: "insensitive" } },
          { lastName: { contains: query.q, mode: "insensitive" } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { _count: { select: PAID_ORDERS } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    res.json(paged(rows.map(toListItem), { page: query.page, pageSize: query.pageSize, total }));
  });

  router.patch("/:id", write, async (req, res) => {
    const input = AdminUserUpdate.parse(req.body);
    if (pathParam(req, "id") === req.user!.sub) {
      throw new AppError("FORBIDDEN", "You can't change your own role or access.");
    }
    const user = await prisma.$transaction(async (tx) => {
      const before = await loadUser(tx, pathParam(req, "id"));
      await assertNotLastSuperAdmin(tx, before, input);
      const demotedToCustomer = input.role === "CUSTOMER" && isAdminRole(before.role);
      await tx.user.update({
        where: { id: before.id },
        data: {
          ...(input.role && { role: input.role }),
          ...(input.disabled !== undefined && { disabledAt: input.disabled ? new Date() : null }),
          ...(demotedToCustomer && {
            totpSecretEnc: null,
            totpEnabledAt: null,
            totpLastStep: null,
          }),
        },
      });
      // Any change of access ends existing sessions, so it takes effect immediately.
      await revokeAllSessions(tx, before.id);
      const after = await loadUser(tx, before.id);
      await audit(tx, req, {
        action: "user.update",
        entity: "User",
        entityId: before.id,
        before: accessSnapshot(before),
        after: accessSnapshot(after),
      });
      return after;
    });
    res.json(ok(toListItem(user)));
  });

  router.post("/invite", write, async (req, res) => {
    const input = AdminInviteInput.parse(req.body);
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw new AppError(
        "CONFLICT",
        "An account with that email already exists. Change its role instead.",
      );
    }
    const { user, token } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { ...input, passwordHash: await hashPassword(randomToken()) },
      });
      const inviteToken = await createAdminInvite(tx, created.id);
      await audit(tx, req, {
        action: "user.invite",
        entity: "User",
        entityId: created.id,
        after: { email: created.email, role: created.role },
      });
      return { user: await loadUser(tx, created.id), token: inviteToken };
    });
    await emailInvite(user, token);
    res.status(201).json(ok(toListItem(user)));
  });

  // Resends an invite, e.g. after a lost phone: resets the password and 2FA enrollment.
  router.post("/:id/invite", write, async (req, res) => {
    if (pathParam(req, "id") === req.user!.sub) {
      throw new AppError("FORBIDDEN", "Ask another super admin to reset your access.");
    }
    const { user, token } = await prisma.$transaction(async (tx) => {
      const target = await loadUser(tx, pathParam(req, "id"));
      if (!isAdminRole(target.role) || target.disabledAt) {
        throw new AppError("CONFLICT", "Only active staff accounts can be sent an invite.");
      }
      const inviteToken = await createAdminInvite(tx, target.id);
      await audit(tx, req, { action: "user.reinvite", entity: "User", entityId: target.id });
      return { user: await loadUser(tx, target.id), token: inviteToken };
    });
    await emailInvite(user, token);
    res.json(ok(toListItem(user)));
  });

  return router;
}

/** /admin/audit-log */
export function auditLogRouter(): Router {
  const router = Router();
  router.get("/", requirePermission("audit:read"), async (req, res) => {
    const query = AuditLogQuery.parse(req.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entity && { entity: query.entity }),
      ...(query.actorId && { actorId: query.actorId }),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
    const actors = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } },
      select: { id: true, email: true },
    });
    const emailOf = new Map(actors.map((a) => [a.id, a.email]));
    const items: AuditLogEntry[] = rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorEmail: emailOf.get(r.actorId) ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.before ?? null,
      after: r.after ?? null,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(paged(items, { page: query.page, pageSize: query.pageSize, total }));
  });
  return router;
}

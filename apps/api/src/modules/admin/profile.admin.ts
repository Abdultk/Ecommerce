import { Router } from "express";
import type { User } from "@prisma/client";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import argon2 from "argon2";
import { ChangePasswordInput, ProfileUpdate, ok, type AdminProfile } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { consumeOrThrow } from "../../lib/rate-limit";
import { hashPassword } from "../auth/auth.service";
import { revokeOtherSessions, toPublicUser } from "../auth/session";
import { verifyStepUp } from "../auth/step-up";
import { audit } from "./audit";

const WRONG_PASSWORD = "Your current password is incorrect.";

const toAdminProfile = (user: User): AdminProfile => ({
  ...toPublicUser(user),
  totpEnabledAt: user.totpEnabledAt?.toISOString() ?? null,
});

async function currentUser(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return user;
}

/**
 * /admin/me: the signed-in admin's own profile. Name only (email changes go through a
 * SUPER_ADMIN); the password change needs the current password AND a fresh 2FA code and
 * signs out every other device. Lost authenticator: a SUPER_ADMIN resets 2FA (§5).
 */
export function profileAdminRouter(deps: { stepUpLimiter: RateLimiterAbstract }): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json(ok(toAdminProfile(await currentUser(req.user!.sub))));
  });

  router.patch("/", async (req, res) => {
    const input = ProfileUpdate.parse(req.body);
    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
      const after = await tx.user.update({ where: { id: before.id }, data: input });
      await audit(tx, req, {
        action: "user.profile_update",
        entity: "User",
        entityId: before.id,
        before: { firstName: before.firstName, lastName: before.lastName },
        after: { firstName: after.firstName, lastName: after.lastName },
      });
      return after;
    });
    res.json(ok(toAdminProfile(user)));
  });

  router.post("/password", async (req, res) => {
    const input = ChangePasswordInput.parse(req.body);
    const user = await currentUser(req.user!.sub);
    // Wrong-password guesses share the per-admin 2FA budget with the code check below.
    await consumeOrThrow(deps.stepUpLimiter, `user:${user.id}`);
    if (!(await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false))) {
      throw new AppError("UNAUTHENTICATED", WRONG_PASSWORD);
    }
    await verifyStepUp(prisma, user.id, input.totpCode, deps.stepUpLimiter);
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await revokeOtherSessions(tx, user.id, req.user!.fam);
      await audit(tx, req, { action: "user.password_change", entity: "User", entityId: user.id });
    });
    res.json(ok(null));
  });

  router.post("/sessions/revoke-others", async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const revoked = await revokeOtherSessions(tx, req.user!.sub, req.user!.fam);
      await audit(tx, req, {
        action: "user.sessions_revoked",
        entity: "User",
        entityId: req.user!.sub,
        after: { revoked },
      });
    });
    res.json(ok(null));
  });

  return router;
}

import { Router, type Request } from "express";
import type { User } from "@prisma/client";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { AdminPasswordResetInput, isAdminRole, ok, type PasswordResetSent } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { Mailer, OutgoingMail } from "../../lib/mailer";
import { pathParam } from "../../lib/params";
import { prisma } from "../../lib/prisma";
import { consumeOrThrow } from "../../lib/rate-limit";
import { safeErrorFields } from "../../lib/safe-error";
import { requirePermission } from "../../middleware/authenticate";
import { issuePasswordReset, passwordResetEmail } from "../auth/auth.service";
import { createAdminInvite, inviteLink } from "../auth/invites";
import { revokeAllSessions } from "../auth/session";
import { audit } from "./audit";

/** Who may reset whom: never yourself; staff only by a SUPER_ADMIN; 2FA reset only for staff. */
function assertMayReset(req: Request, target: User, resetTwoFactor: boolean): void {
  const actor = req.user!;
  if (target.id === actor.sub) {
    throw new AppError("FORBIDDEN", "Change your own password from your profile.");
  }
  const staff = isAdminRole(target.role);
  if (staff && actor.role !== "SUPER_ADMIN") {
    throw new AppError("FORBIDDEN", "Only a super admin can reset a staff member's password.");
  }
  if (resetTwoFactor && !staff) {
    throw new AppError("VALIDATION_ERROR", "Only staff accounts have two-factor sign-in to reset.");
  }
  if (target.disabledAt) {
    throw new AppError("CONFLICT", "This account is disabled. Enable it first.");
  }
}

function inviteEmail(user: User, token: string): OutgoingMail {
  return {
    to: user.email,
    subject: "Set up your PAISLEY art admin sign-in again",
    text: `Hi ${user.firstName},\n\nA super admin reset your password and two-factor sign-in. Set a new password and connect your authenticator app here:\n${inviteLink(token)}\n\nThis link expires in 72 hours and works once.`,
  };
}

/**
 * Prepares the reset inside one transaction: earlier reset links are voided and every
 * session ends. With resetTwoFactor the staff member gets a fresh invite instead (which also
 * clears TOTP), so they re-enroll 2FA through the accept-invite flow.
 */
async function prepareReset(
  req: Request,
  target: User,
  resetTwoFactor: boolean,
): Promise<OutgoingMail> {
  return prisma.$transaction(async (tx) => {
    const mail = resetTwoFactor
      ? inviteEmail(target, await createAdminInvite(tx, target.id))
      : passwordResetEmail(target, await issuePasswordReset(tx, target.id), true);
    await revokeAllSessions(tx, target.id);
    await audit(tx, req, {
      action: "user.password_reset_sent",
      entity: "User",
      entityId: target.id,
      after: { resetTwoFactor, staff: isAdminRole(target.role) },
    });
    return mail;
  });
}

/** POST /admin/users/:userId/password-reset: emails a reset link; admins never see passwords. */
export function passwordResetAdminRouter(deps: {
  mailer: Mailer;
  limiter: RateLimiterAbstract;
}): Router {
  const router = Router();
  router.post(
    "/:userId/password-reset",
    requirePermission("user:reset-password"),
    async (req, res) => {
      const input = AdminPasswordResetInput.parse(req.body ?? {});
      const target = await prisma.user.findUnique({ where: { id: pathParam(req, "userId") } });
      if (!target) throw new AppError("NOT_FOUND", "User not found.");
      const resetTwoFactor = input.resetTwoFactor === true;
      assertMayReset(req, target, resetTwoFactor);
      await consumeOrThrow(deps.limiter, `admin:${req.user!.sub}`);
      const mail = await prepareReset(req, target, resetTwoFactor);
      try {
        await deps.mailer.send(mail);
      } catch (err) {
        logger.error({ err: safeErrorFields(err) }, "could not send password reset email");
        throw new AppError(
          "INTERNAL",
          "The reset was prepared but the email could not be sent. Try again.",
        );
      }
      const body: PasswordResetSent = { sent: true };
      res.status(202).json(ok(body));
    },
  );
  return router;
}

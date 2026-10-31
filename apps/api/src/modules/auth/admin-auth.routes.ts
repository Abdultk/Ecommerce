import { Router } from "express";
import {
  AcceptInviteInput,
  Admin2faInput,
  AdminLoginInput,
  AdminResetPasswordInput,
  isAdminRole,
  ok,
  type AdminChallenge,
} from "@hp/contracts";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { consumeOrThrow, rateLimit } from "../../lib/rate-limit";
import { checkCredentials, resetPassword } from "./auth.service";
import { acceptInvite } from "./invites";
import { issueSession } from "./session";
import { signAdminChallenge, verifyAdminChallenge } from "./tokens";
import { openSecret, verifyTotp } from "./totp";

const INVALID_CREDENTIALS = "Email or password is incorrect.";
const BAD_CODE = "That code didn't work. Check your authenticator app.";
const NOT_ENROLLED = "Finish setting up your account with the link in your invite email.";

type AdminAuthDeps = {
  loginLimiter: RateLimiterAbstract;
  accountLimiter: RateLimiterAbstract;
  twoFactorLimiter: RateLimiterAbstract;
  /** Keyed by admin id: caps TOTP guesses per account no matter how many IPs are used. */
  twoFactorUserLimiter: RateLimiterAbstract;
  /** Per IP: invite tokens are long and random, but attempts are still capped. */
  inviteLimiter: RateLimiterAbstract;
};

/**
 * Two-step admin sign-in: password → short-lived challenge → TOTP code → session.
 * Enrollment happens only through an emailed invite (accept-invite), so knowing an
 * admin's password is never enough to register an authenticator.
 */
export function adminAuthRouter({
  loginLimiter,
  accountLimiter,
  twoFactorLimiter,
  twoFactorUserLimiter,
  inviteLimiter,
}: AdminAuthDeps): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/login", rateLimit(loginLimiter), async (req, res) => {
    const input = AdminLoginInput.parse(req.body);
    await consumeOrThrow(accountLimiter, `acct:${input.email}`);
    const user = await checkCredentials(prisma, input);
    // Non-admins get the same answer as a wrong password: no hint that the account exists.
    if (!user || !isAdminRole(user.role))
      throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);

    if (!user.totpEnabledAt) throw new AppError("FORBIDDEN", NOT_ENROLLED);

    const challenge: AdminChallenge = {
      challengeToken: signAdminChallenge(user.id),
      enrollmentRequired: false,
    };
    res.json(ok(challenge));
  });

  router.post("/accept-invite", rateLimit(inviteLimiter), async (req, res) => {
    res.json(ok(await acceptInvite(prisma, AcceptInviteInput.parse(req.body))));
  });

  // Staff password reset from an emailed link (admin-initiated or self-service). Customer
  // tokens are refused here; 2FA stays enrolled, so sign-in still needs the authenticator.
  router.post("/reset-password", rateLimit(inviteLimiter), async (req, res) => {
    await resetPassword(AdminResetPasswordInput.parse(req.body), "staff");
    res.json(ok(null));
  });

  router.post("/2fa", rateLimit(twoFactorLimiter), async (req, res) => {
    const input = Admin2faInput.parse(req.body);
    const userId = verifyAdminChallenge(input.challengeToken);
    await consumeOrThrow(twoFactorUserLimiter, `user:${userId}`);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabledAt || !isAdminRole(user.role) || !user.totpSecretEnc) {
      throw new AppError("UNAUTHENTICATED", "Your sign-in expired. Please start again.");
    }

    const step = verifyTotp(input.code, openSecret(user.totpSecretEnc), user.totpLastStep);
    if (step === null) throw new AppError("UNAUTHENTICATED", BAD_CODE);

    // Record the step atomically so a code can't be used twice, even concurrently.
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: {
        totpLastStep: step,
        totpEnabledAt: user.totpEnabledAt ?? new Date(),
        lastLoginAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new AppError("UNAUTHENTICATED", BAD_CODE);

    const session = await issueSession(prisma, res, user, {
      kind: "admin",
      twoFactorVerified: true,
      req,
    });
    res.json(ok(session));
  });

  return router;
}

import { Router } from "express";
import {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ok,
} from "@hp/contracts";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { AppError } from "../../lib/errors";
import type { Mailer } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { consumeOrThrow, rateLimit } from "../../lib/rate-limit";
import { isAdminOrigin, requireAllowedOrigin } from "../../middleware/origin-check";
import {
  login,
  register,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "./auth.service";
import {
  clearRefreshCookie,
  endSession,
  issueSession,
  refreshCookieFrom,
  rotateSession,
} from "./session";

type AuthDeps = {
  mailer: Mailer;
  loginLimiter: RateLimiterAbstract;
  /** Keyed by email, so one account cannot be hammered from many IPs. */
  accountLimiter: RateLimiterAbstract;
  resetLimiter: RateLimiterAbstract;
};

export function authRouter({
  mailer,
  loginLimiter,
  accountLimiter,
  resetLimiter,
}: AuthDeps): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/register", rateLimit(loginLimiter), async (req, res) => {
    await register(mailer, RegisterInput.parse(req.body));
    // Same answer whether or not the email already had an account.
    res.status(202).json(ok(null));
  });

  router.post("/resend-verification", rateLimit(resetLimiter), async (req, res) => {
    await resendVerification(mailer, ResendVerificationInput.parse(req.body).email);
    res.status(202).json(ok(null));
  });

  router.post("/login", rateLimit(loginLimiter), async (req, res) => {
    const input = LoginInput.parse(req.body);
    await consumeOrThrow(accountLimiter, `acct:${input.email}`);
    const user = await login(prisma, input);
    const session = await issueSession(prisma, res, user, {
      kind: "customer",
      twoFactorVerified: false,
      req,
    });
    res.json(ok(session));
  });

  // The admin app and the storefront share this endpoint; the Origin picks the cookie.
  router.post("/refresh", requireAllowedOrigin, async (req, res) => {
    const kind = isAdminOrigin(req) ? "admin" : "customer";
    try {
      res.json(ok(await rotateSession(prisma, res, refreshCookieFrom(req, kind), kind, req)));
    } catch (err) {
      if (err instanceof AppError) clearRefreshCookie(res, kind);
      throw err;
    }
  });

  router.post("/logout", requireAllowedOrigin, async (req, res) => {
    const kind = isAdminOrigin(req) ? "admin" : "customer";
    await endSession(prisma, refreshCookieFrom(req, kind));
    clearRefreshCookie(res, kind);
    res.json(ok(null));
  });

  router.post("/verify-email", async (req, res) => {
    await verifyEmail(VerifyEmailInput.parse(req.body).token);
    res.json(ok(null));
  });

  router.post("/forgot-password", rateLimit(resetLimiter), async (req, res) => {
    await requestPasswordReset(mailer, ForgotPasswordInput.parse(req.body).email);
    res.status(202).json(ok(null));
  });

  router.post("/reset-password", rateLimit(resetLimiter), async (req, res) => {
    await resetPassword(ResetPasswordInput.parse(req.body));
    res.json(ok(null));
  });

  return router;
}

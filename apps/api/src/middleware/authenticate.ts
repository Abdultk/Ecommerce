import type { RequestHandler } from "express";
import { can, isAdminRole, type Permission } from "@hp/contracts";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { verifyAccess } from "../modules/auth/tokens";

const bearer = (header: string | undefined): string | null =>
  header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;

/** Requires a valid access token. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token = bearer(req.headers.authorization);
  if (!token) return next(new AppError("UNAUTHENTICATED", "Please sign in."));
  try {
    req.user = verifyAccess(token);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Attaches the user when a token is present (e.g. cart routes serve guests too).
 * A present-but-invalid token is still an error, so the client knows to refresh.
 */
export const optionalAuth: RequestHandler = (req, res, next) =>
  req.headers.authorization ? authenticate(req, res, next) : next();

/**
 * Admin gate. Beyond the token claims it re-reads the account, so disabling an admin
 * or changing their role takes effect immediately rather than when the token expires.
 */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  try {
    const claims = req.user;
    if (!claims) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    if (!isAdminRole(claims.role)) throw new AppError("FORBIDDEN", "Admin access only.");
    if (!claims.tfa) throw new AppError("FORBIDDEN", "Two-factor verification required.");

    const account = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { role: true, disabledAt: true },
    });
    if (!account || account.disabledAt) {
      throw new AppError("UNAUTHENTICATED", "Your session has ended. Please sign in again.");
    }
    if (!isAdminRole(account.role)) throw new AppError("FORBIDDEN", "Admin access only.");

    req.user = { ...claims, role: account.role };
    next();
  } catch (err) {
    next(err);
  }
};

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) =>
    req.user && can(req.user.role, permission)
      ? next()
      : next(new AppError("FORBIDDEN", "You don't have permission to do that."));

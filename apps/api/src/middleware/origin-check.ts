import type { Request, RequestHandler } from "express";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([env.WEB_ORIGIN, env.ADMIN_ORIGIN]);

export const isAdminOrigin = (req: Request): boolean => req.get("origin") === env.ADMIN_ORIGIN;

/**
 * CSRF defense for cookie-authenticated endpoints (refresh, logout): browsers always send
 * Origin on cross-origin POSTs, so a missing or unknown Origin is refused.
 */
export const requireAllowedOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return next(new AppError("FORBIDDEN", "Request origin not allowed."));
  }
  next();
};

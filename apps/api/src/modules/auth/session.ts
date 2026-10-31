import type { Request, Response } from "express";
import type { User } from "@prisma/client";
import type { AuthSession, PublicUser } from "@hp/contracts";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { hashToken, randomToken } from "../../lib/crypto";
import type { DbClient } from "../../lib/prisma";
import { signAccess } from "./tokens";

/**
 * Refresh sessions. Storefront and admin get separate cookies so a shopper session on
 * www can never be used to call the API as an admin, and vice versa.
 */
export type SessionKind = "customer" | "admin";

const COOKIE_PATH = "/api/v1/auth";
const DAY_MS = 24 * 3600_000;
const HOUR_MS = 3600_000;

/**
 * ttlMs: idle lifetime of one refresh token (renewed on each rotation).
 * familyMaxMs: absolute lifetime of the whole sign-in, so a stolen chain that keeps
 * refreshing still dies; after it the user must sign in again.
 */
const COOKIES: Record<
  SessionKind,
  { name: string; ttlMs: number; familyMaxMs: number; sameSite: "lax" | "strict" }
> = {
  customer: { name: "hp_refresh", ttlMs: 30 * DAY_MS, familyMaxMs: 90 * DAY_MS, sameSite: "lax" },
  admin: {
    name: "hp_admin_refresh",
    ttlMs: 8 * HOUR_MS,
    familyMaxMs: 12 * HOUR_MS,
    sameSite: "strict",
  },
};

const SESSION_ENDED = "Your session has ended. Please sign in again.";

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  emailVerified: user.emailVerifiedAt !== null,
});

const hash = (token: string) => hashToken(token, env.REFRESH_TOKEN_PEPPER);

export const refreshCookieFrom = (req: Request, kind: SessionKind): string | undefined => {
  const value: unknown = req.cookies?.[COOKIES[kind].name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

function setRefreshCookie(res: Response, kind: SessionKind, token: string) {
  const { name, ttlMs, sameSite } = COOKIES[kind];
  res.cookie(name, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite,
    path: COOKIE_PATH,
    maxAge: ttlMs,
  });
}

export function clearRefreshCookie(res: Response, kind: SessionKind) {
  const { name, sameSite } = COOKIES[kind];
  res.clearCookie(name, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite,
    path: COOKIE_PATH,
  });
}

type IssueOptions = {
  kind: SessionKind;
  twoFactorVerified: boolean;
  /** Present when rotating: keeps the chain and its absolute expiry. */
  family?: { id: string; expiresAt: Date };
  req: Request;
};

/** Creates a refresh token row, sets the cookie, and returns the session body. */
export async function issueSession(
  db: DbClient,
  res: Response,
  user: User,
  opts: IssueOptions,
): Promise<AuthSession> {
  const token = randomToken();
  const now = Date.now();
  const familyId = opts.family?.id ?? randomToken(16);
  const familyExpiresAt = opts.family?.expiresAt ?? new Date(now + COOKIES[opts.kind].familyMaxMs);
  const expiresAt = new Date(Math.min(now + COOKIES[opts.kind].ttlMs, familyExpiresAt.getTime()));
  await db.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash: hash(token),
      twoFactorVerified: opts.twoFactorVerified,
      expiresAt,
      familyExpiresAt,
      userAgent: opts.req.get("user-agent")?.slice(0, 300) ?? null,
      ip: opts.req.ip ?? null,
    },
  });
  setRefreshCookie(res, opts.kind, token);
  return {
    accessToken: signAccess({
      sub: user.id,
      role: user.role,
      tfa: opts.twoFactorVerified,
      fam: familyId,
    }),
    user: toPublicUser(user),
  };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token is treated as theft:
 * the whole token family is revoked and every holder must sign in again.
 */
export async function rotateSession(
  db: DbClient,
  res: Response,
  presented: string | undefined,
  kind: SessionKind,
  req: Request,
): Promise<AuthSession> {
  if (!presented) throw new AppError("UNAUTHENTICATED", SESSION_ENDED);

  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hash(presented) },
    include: { user: true },
  });
  if (!existing) throw new AppError("UNAUTHENTICATED", SESSION_ENDED);

  if (existing.revokedAt) {
    await revokeFamily(db, existing.familyId);
    throw new AppError("UNAUTHENTICATED", SESSION_ENDED);
  }
  // An admin cookie must come from a 2FA-verified sign-in.
  const kindMismatch = kind === "admin" && !existing.twoFactorVerified;
  const now = new Date();
  const expired = existing.expiresAt <= now || existing.familyExpiresAt <= now;
  if (expired || existing.user.disabledAt || kindMismatch) {
    throw new AppError("UNAUTHENTICATED", SESSION_ENDED);
  }

  // Claim the row atomically so two concurrent refreshes cannot both succeed.
  const claimed = await db.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    await revokeFamily(db, existing.familyId);
    throw new AppError("UNAUTHENTICATED", SESSION_ENDED);
  }

  const session = await issueSession(db, res, existing.user, {
    kind,
    twoFactorVerified: existing.twoFactorVerified,
    family: { id: existing.familyId, expiresAt: existing.familyExpiresAt },
    req,
  });
  return session;
}

export async function revokeFamily(db: DbClient, familyId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Logout: revokes the presented token's family. Unknown tokens are ignored. */
export async function endSession(db: DbClient, presented: string | undefined): Promise<void> {
  if (!presented) return;
  const existing = await db.refreshToken.findUnique({ where: { tokenHash: hash(presented) } });
  if (existing) await revokeFamily(db, existing.familyId);
}

/** Signs out every other device; keeps the sign-in `keepFamilyId` (all of them when absent). */
export async function revokeOtherSessions(
  db: DbClient,
  userId: string,
  keepFamilyId: string | undefined,
): Promise<number> {
  const { count } = await db.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepFamilyId && { familyId: { not: keepFamilyId } }),
    },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function revokeAllSessions(db: DbClient, userId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

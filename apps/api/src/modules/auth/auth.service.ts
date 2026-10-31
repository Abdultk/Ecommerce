import argon2 from "argon2";
import { safeErrorFields } from "../../lib/safe-error";
import type { User, UserTokenType } from "@prisma/client";
import {
  isAdminRole,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from "@hp/contracts";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { hashToken, randomToken } from "../../lib/crypto";
import type { Mailer, OutgoingMail } from "../../lib/mailer";
import { prisma, type DbClient } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { revokeAllSessions } from "./session";

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations).
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const VERIFY_EMAIL_TTL_MS = 24 * 3600_000;
const RESET_PASSWORD_TTL_MS = 3600_000;
const INVALID_CREDENTIALS = "Email or password is incorrect.";
const INVALID_LINK = "This link has expired or was already used.";

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, ARGON2_OPTIONS);

// Verifying against a dummy hash for unknown emails keeps response times uniform,
// so timing does not reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

async function passwordMatches(user: User | null, password: string): Promise<boolean> {
  if (!user) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    return false;
  }
  return argon2.verify(user.passwordHash, password).catch(() => false);
}

/** Password check shared by customer and admin sign-in. Returns null for any failure. */
export async function checkCredentials(db: DbClient, input: LoginInput): Promise<User | null> {
  const user = await db.user.findUnique({ where: { email: input.email } });
  const ok = await passwordMatches(user, input.password);
  return ok && user && !user.disabledAt ? user : null;
}

export async function login(db: DbClient, input: LoginInput): Promise<User> {
  const user = await checkCredentials(db, input);
  if (!user) throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  return db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
}

export async function createUserToken(
  db: DbClient,
  userId: string,
  type: UserTokenType,
  ttlMs: number,
) {
  const token = randomToken();
  await db.userToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

/** Marks a token used exactly once; returns its user id or throws. */
export async function consumeUserToken(
  db: DbClient,
  token: string,
  type: UserTokenType,
): Promise<string> {
  const row = await db.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) {
    throw new AppError("VALIDATION_ERROR", INVALID_LINK);
  }
  const claimed = await db.userToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) throw new AppError("VALIDATION_ERROR", INVALID_LINK);
  return row.userId;
}

/** Email failures are logged, never surfaced: the account action already succeeded. */
async function sendSafely(mailer: Mailer, to: string, subject: string, text: string) {
  try {
    await mailer.send({ to, subject, text });
  } catch (err) {
    logger.error({ err: safeErrorFields(err), subject }, "failed to send email");
  }
}

const verificationMail = (user: Pick<User, "firstName">, token: string) =>
  `Hi ${user.firstName},\n\nConfirm your email address:\n${env.WEB_ORIGIN}/verify-email#token=${token}\n\nThis link expires in 24 hours.`;

const VERIFY_SUBJECT = "Confirm your email for PAISLEY art";

/**
 * Always looks the same to the caller. A new email gets a verification link; an email that
 * already has an account gets a notice instead, so the form cannot be used to discover accounts.
 */
export async function register(mailer: Mailer, input: RegisterInput): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  const created = await prisma
    .$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.email } })) return null;
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });
      return { user, token: await createUserToken(tx, user.id, "VERIFY_EMAIL", VERIFY_EMAIL_TTL_MS) };
    })
    .catch((err: unknown) => {
      // A concurrent sign-up for the same email loses the unique-index race: same outcome.
      if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") return null;
      throw err;
    });

  if (created) {
    await sendSafely(mailer, created.user.email, VERIFY_SUBJECT, verificationMail(created.user, created.token));
    return;
  }
  await sendSafely(
    mailer,
    input.email,
    "Someone tried to create an account with your email",
    `Hi ${input.firstName},\n\nSomeone tried to register a PAISLEY art account with this email address, but you already have one.\n\nSign in: ${env.WEB_ORIGIN}/login\nForgot your password? ${env.WEB_ORIGIN}/forgot-password\n\nIf it wasn't you, you can ignore this email.`,
  );
}

/** Sends a fresh verification link to an unverified customer; silent for everyone else. */
export async function resendVerification(mailer: Mailer, email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.disabledAt || user.emailVerifiedAt || isAdminRole(user.role)) return;
  const token = await prisma.$transaction(async (tx) => {
    await tx.userToken.updateMany({
      where: { userId: user.id, type: "VERIFY_EMAIL", usedAt: null },
      data: { usedAt: new Date() },
    });
    return createUserToken(tx, user.id, "VERIFY_EMAIL", VERIFY_EMAIL_TTL_MS);
  });
  await sendSafely(mailer, user.email, VERIFY_SUBJECT, verificationMail(user, token));
}

export async function verifyEmail(token: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const userId = await consumeUserToken(tx, token, "VERIFY_EMAIL");
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  });
}

/**
 * Creates a 1-hour reset token after voiding the user's earlier unused ones, so only the
 * newest link works.
 */
export async function issuePasswordReset(db: DbClient, userId: string): Promise<string> {
  await db.userToken.updateMany({
    where: { userId, type: "RESET_PASSWORD", usedAt: null },
    data: { usedAt: new Date() },
  });
  return createUserToken(db, userId, "RESET_PASSWORD", RESET_PASSWORD_TTL_MS);
}

/** Staff reset on the admin site, customers on the storefront (token in the fragment). */
export const resetLink = (user: Pick<User, "role">, token: string): string =>
  `${isAdminRole(user.role) ? env.ADMIN_ORIGIN : env.WEB_ORIGIN}/reset-password#token=${token}`;

export function passwordResetEmail(
  user: Pick<User, "email" | "firstName" | "role">,
  token: string,
  byAdmin: boolean,
): OutgoingMail {
  const why = byAdmin
    ? "A PAISLEY art team member sent you this link to set a new password. You've been signed out on all devices."
    : "Someone (hopefully you) asked to reset your password. If it wasn't you, you can ignore this email.";
  return {
    to: user.email,
    subject: "Reset your PAISLEY art password",
    text: `Hi ${user.firstName},\n\n${why}\n\nSet a new password:\n${resetLink(user, token)}\n\nThis link expires in 1 hour and works once.`,
  };
}

/** Always succeeds from the caller's view, so it cannot be used to discover accounts. */
export async function requestPasswordReset(mailer: Mailer, email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.disabledAt) return;
  const token = await prisma.$transaction((tx) => issuePasswordReset(tx, user.id));
  const mail = passwordResetEmail(user, token, false);
  await sendSafely(mailer, mail.to, mail.subject, mail.text);
}

/**
 * Sets the new password and signs the user out everywhere. Staff tokens only work on the
 * admin endpoint and customer tokens only on the storefront one; a mismatch rolls back, so
 * the token stays usable where it belongs.
 */
export async function resetPassword(
  input: ResetPasswordInput,
  audience: "customer" | "staff" = "customer",
): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const userId = await consumeUserToken(tx, input.token, "RESET_PASSWORD");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (isAdminRole(user.role) !== (audience === "staff") || user.disabledAt) {
      throw new AppError("VALIDATION_ERROR", INVALID_LINK);
    }
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await revokeAllSessions(tx, userId);
  });
}

import type { User } from "@prisma/client";
import { isAdminRole, type AcceptInviteInput, type AdminChallenge } from "@hp/contracts";
import { env } from "../../config/env";
import { randomToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import type { Mailer } from "../../lib/mailer";
import type { Db, DbClient } from "../../lib/prisma";
import { consumeUserToken, createUserToken, hashPassword } from "./auth.service";
import { revokeAllSessions } from "./session";
import { signAdminChallenge } from "./tokens";
import { generateTotpSecret, otpauthUrl, sealSecret } from "./totp";

export const INVITE_TTL_MS = 72 * 3600_000;

/**
 * Starts (or restarts) staff access: earlier invites are voided, the password becomes
 * unusable and 2FA is un-enrolled, so only whoever holds the new invite can set them up.
 * Returns the raw token; callers email it (or print it, for the seed script).
 */
export async function createAdminInvite(tx: DbClient, userId: string): Promise<string> {
  await tx.userToken.updateMany({
    where: { userId, type: "ADMIN_INVITE", usedAt: null },
    data: { usedAt: new Date() },
  });
  await tx.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(randomToken()),
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
    },
  });
  await revokeAllSessions(tx, userId);
  return createUserToken(tx, userId, "ADMIN_INVITE", INVITE_TTL_MS);
}

/** The link carries the token in the fragment so it never reaches server logs. */
export const inviteLink = (token: string): string =>
  `${env.ADMIN_ORIGIN}/accept-invite#token=${token}`;

export async function sendInviteEmail(
  mailer: Mailer,
  user: Pick<User, "email" | "firstName">,
  token: string,
): Promise<void> {
  await mailer.send({
    to: user.email,
    subject: "You're invited to the PAISLEY art admin",
    text: `Hi ${user.firstName},\n\nSet your password and two-factor sign-in here:\n${inviteLink(token)}\n\nThis link expires in 72 hours and works once.`,
  });
}

/**
 * Redeems an invite: sets the password and issues a fresh TOTP secret. The returned
 * challenge goes to POST /admin/auth/2fa, where the first valid code completes enrollment.
 */
export async function acceptInvite(db: Db, input: AcceptInviteInput): Promise<AdminChallenge> {
  const passwordHash = await hashPassword(input.password);
  const secret = generateTotpSecret();
  const user = await db.$transaction(async (tx) => {
    const userId = await consumeUserToken(tx, input.token, "ADMIN_INVITE");
    const found = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (found.disabledAt || !isAdminRole(found.role)) {
      throw new AppError("VALIDATION_ERROR", "This link has expired or was already used.");
    }
    return tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        emailVerifiedAt: found.emailVerifiedAt ?? new Date(),
        totpSecretEnc: sealSecret(secret),
        totpEnabledAt: null,
        totpLastStep: null,
      },
    });
  });
  return {
    challengeToken: signAdminChallenge(user.id),
    enrollmentRequired: true,
    otpauthUrl: otpauthUrl(user.email, secret),
  };
}

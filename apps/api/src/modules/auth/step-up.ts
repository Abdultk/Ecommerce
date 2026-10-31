import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { AppError } from "../../lib/errors";
import type { DbClient } from "../../lib/prisma";
import { consumeOrThrow } from "../../lib/rate-limit";
import { openSecret, verifyTotp } from "./totp";

export const BAD_STEP_UP_CODE = "That 2FA code didn't work. Check your authenticator app.";

/**
 * Step-up check for sensitive admin changes (bank details, currency, own password): the
 * signed-in admin proves a fresh TOTP code. Guesses share the per-admin 2FA budget, and the
 * accepted time-step is claimed atomically so the same code can't be used twice.
 */
export async function verifyStepUp(
  db: DbClient,
  userId: string,
  code: string,
  limiter: RateLimiterAbstract,
): Promise<void> {
  await consumeOrThrow(limiter, `user:${userId}`);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true },
  });
  if (!user?.totpSecretEnc || !user.totpEnabledAt) {
    throw new AppError("FORBIDDEN", "Set up two-factor sign-in before making this change.");
  }
  const step = verifyTotp(code, openSecret(user.totpSecretEnc), user.totpLastStep);
  if (step === null) throw new AppError("UNAUTHENTICATED", BAD_STEP_UP_CODE);
  const claimed = await db.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  if (claimed.count === 0) throw new AppError("UNAUTHENTICATED", BAD_STEP_UP_CODE);
}

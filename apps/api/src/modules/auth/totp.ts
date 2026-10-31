import { authenticator } from "otplib";
import { env } from "../../config/env";
import { decrypt, encrypt } from "../../lib/crypto";

const ISSUER = "PAISLEY art Admin";
const STEP_SECONDS = 30;

// Accept the previous and next 30-second window to tolerate clock drift.
authenticator.options = { window: 1, step: STEP_SECONDS };

export const generateTotpSecret = (): string => authenticator.generateSecret();
export const otpauthUrl = (email: string, secret: string): string =>
  authenticator.keyuri(email, ISSUER, secret);

export const sealSecret = (secret: string): string => encrypt(secret, env.TOTP_ENCRYPTION_KEY);
export const openSecret = (sealed: string): string => decrypt(sealed, env.TOTP_ENCRYPTION_KEY);

const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);

/**
 * Returns the time-step the code belongs to, or null if invalid or already used.
 * Callers store the step so the same code cannot be replayed.
 */
export function verifyTotp(
  code: string,
  secret: string,
  lastUsedStep: number | null,
): number | null {
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  const step = currentStep() + delta;
  return lastUsedStep !== null && step <= lastUsedStep ? null : step;
}

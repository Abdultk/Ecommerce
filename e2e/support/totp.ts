import { authenticator } from "otplib";

export const TOTP_STEP_SECONDS = 30;

const currentStep = (): number => Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

export const secretFromOtpauthUrl = (otpauthUrl: string): string => {
  const secret = new URL(otpauthUrl).searchParams.get("secret");
  if (!secret) throw new Error(`No secret in ${otpauthUrl}`);
  return secret;
};

/**
 * The API accepts the previous, current and next 30-second step but never a step at or
 * below the last one used. So after a code is spent, the next sign-in uses the following
 * step, which is valid immediately; no waiting for the clock.
 */
export function totpCode(
  secret: string,
  lastUsedStep: number | null,
): { code: string; step: number } {
  const now = currentStep();
  const step = lastUsedStep === null ? now : Math.max(now, lastUsedStep + 1);
  if (step > now + 1) {
    throw new Error("Two codes were already used within this 30s window; use another admin.");
  }
  const code = authenticator.clone({ epoch: step * TOTP_STEP_SECONDS * 1000 }).generate(secret);
  return { code, step };
}

/** Every code the API would accept right now (previous, current and next step). */
export function acceptedCodes(secret: string): Set<string> {
  const now = currentStep();
  return new Set(
    [now - 1, now, now + 1].map((step) =>
      authenticator.clone({ epoch: step * TOTP_STEP_SECONDS * 1000 }).generate(secret),
    ),
  );
}

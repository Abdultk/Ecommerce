import jwt from "jsonwebtoken";
import { z } from "zod";
import { RoleSchema } from "@hp/contracts";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";

const ISSUER = "hp-api";
const ACCESS_AUDIENCE = "hp-access";
const CHALLENGE_AUDIENCE = "hp-admin-challenge";
const ACCESS_TTL_SECONDS = 15 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;

/** `fam`: the refresh-token family (sign-in) this access token came from, so "sign out other
 * devices" can keep the current one. Absent on tokens minted outside a session (tests). */
const AccessClaims = z.object({
  sub: z.string().min(1),
  role: RoleSchema,
  tfa: z.boolean(),
  fam: z.string().min(1).optional(),
});
export type AccessClaims = z.infer<typeof AccessClaims>;

const verifyOptions = (audience: string): jwt.VerifyOptions => ({
  issuer: ISSUER,
  audience,
  algorithms: ["HS256"],
});

export function signAccess(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

/** Throws UNAUTHENTICATED for any invalid, expired or malformed token. */
export function verifyAccess(token: string): AccessClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, verifyOptions(ACCESS_AUDIENCE));
    return AccessClaims.parse(payload);
  } catch {
    throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  }
}

/** Short-lived proof that the password step of admin sign-in succeeded. */
export function signAdminChallenge(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: CHALLENGE_AUDIENCE,
    expiresIn: CHALLENGE_TTL_SECONDS,
  });
}

export function verifyAdminChallenge(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, verifyOptions(CHALLENGE_AUDIENCE));
    return z.object({ sub: z.string().min(1) }).parse(payload).sub;
  } catch {
    throw new AppError("UNAUTHENTICATED", "Your sign-in expired. Please start again.");
  }
}

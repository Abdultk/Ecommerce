import { randomInt } from "node:crypto";

/**
 * A random client address from TEST-NET-2/3 style private space. The E2E API trusts one
 * proxy hop, so each test's requests carry their own X-Forwarded-For and get their own
 * per-IP rate-limit buckets (10/min login, 5/15 min invites, 20/15 min checkouts...).
 */
export const randomClientIp = (): string =>
  `10.${randomInt(1, 255)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;

export const clientIpHeaders = (ip: string = randomClientIp()): Record<string, string> => ({
  "X-Forwarded-For": ip,
});

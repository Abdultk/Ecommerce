import { randomBytes, randomUUID } from "node:crypto";

/** A unique, obviously-test address per call (Mailpit catches everything). */
export const uniqueEmail = (tag: string): string =>
  `e2e-${tag}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@example.test`;

/** Random throwaway password (≥ 12 chars, as the API requires). */
export const randomPassword = (): string => `E2e-${randomBytes(12).toString("base64url")}`;

/** Short unique suffix for product names, slugs and SKUs. */
export const uniqueSuffix = (): string => randomUUID().slice(0, 8);

export const ADDRESS = {
  fullName: "Ada Cook",
  line1: "Al Khuwair, Way 1234",
  city: "Seeb",
  region: "MA",
  /** The governorate as the checkout form lists it. */
  governorateName: "Muscat",
  postalCode: "133",
  country: "OM",
  phone: "+96891234567",
} as const;

import type { Express } from "express";
import request, { type Response } from "supertest";
import type { Role } from "@prisma/client";
import { createApp, type AppOptions, type Limits } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { createMemoryMailer } from "../src/lib/mailer";
import { hashPassword } from "../src/modules/auth/auth.service";
import { signAccess } from "../src/modules/auth/tokens";
import { createFakeGateway, type FakeGateway } from "../src/lib/payments";
import { createFakeStorage } from "../src/lib/storage";
import { createInlineReportQueue } from "../src/lib/report-queue";
import { createLocalReportStorage, type ReportStorage } from "../src/lib/report-storage";
import { runReport } from "../src/modules/reports/report-runner";
import os from "node:os";
import path from "node:path";
import { createAdminInvite } from "../src/modules/auth/invites";
import { sealSecret } from "../src/modules/auth/totp";

export { prisma };

export const WEB = "http://localhost:3000";
export const ADMIN = "http://localhost:3001";
export const PASSWORD = "correct horse battery staple";

/** Generous limits so suites don't trip them; rate-limit tests pass their own. */
const RELAXED_LIMITS: Limits = {
  general: 10_000,
  internal: 10_000,
  login: 1_000,
  loginPerAccount: 1_000,
  adminLogin: 1_000,
  passwordReset: 1_000,
  admin2fa: 1_000,
  admin2faPerUser: 1_000,
  checkout: 1_000,
  coupon: 1_000,
  orderLookup: 1_000,
  reportCreate: 1_000,
  openCheckoutsPerEmail: 1_000,
  openCheckoutsPerClient: 1_000,
  checkoutStatus: 1_000,
  adminPasswordReset: 1_000,
};

export const CDN = "https://cdn.example.test";

export const REPORTS_TEST_DIR = path.join(os.tmpdir(), "hearth-and-pan-reports-test");

export function buildApp(options: Partial<AppOptions> = {}): {
  app: Express;
  mailer: ReturnType<typeof createMemoryMailer>;
  payments: FakeGateway;
  /** Report jobs run in-process; await drain() before checking their status. */
  reports: ReturnType<typeof createInlineReportQueue>;
  reportStorage: ReportStorage;
} {
  const mailer = createMemoryMailer();
  const payments = createFakeGateway();
  const reportStorage =
    options.reportStorage ??
    createLocalReportStorage({
      dir: REPORTS_TEST_DIR,
      publicBaseUrl: "http://localhost:4000",
      secret: process.env.COOKIE_SECRET!,
    });
  const reports = createInlineReportQueue(
    (id) => runReport({ db: prisma, storage: reportStorage }, id),
    (err) => {
      throw err;
    },
  );
  const app = createApp({
    mailer,
    payments,
    storage: createFakeStorage(CDN),
    reportQueue: reports,
    ...options,
    reportStorage,
    limits: { ...RELAXED_LIMITS, ...options.limits },
  });
  return { app, mailer, payments, reports, reportStorage };
}

/** Bearer header for a user. Admin roles get a 2FA-verified token (the flow itself is tested elsewhere). */
export function bearer(user: { id: string; role: Role }): string {
  return `Bearer ${signAccess({ sub: user.id, role: user.role, tfa: user.role !== "CUSTOMER" })}`;
}

/** A valid Omani shipping address (the store ships within Oman only). */
export const OMAN_ADDRESS = {
  fullName: "Ada Cook",
  line1: "Al Khuwair, 33rd Street",
  line2: "Villa 12",
  city: "Muscat",
  region: "MA",
  postalCode: "112",
  country: "OM",
  phone: "+96891234567",
} as const;

/** Empties every table (except Prisma's migration log) between tests. */
export async function resetDb(): Promise<void> {
  // Guard: only ever empty the dedicated test database.
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.endsWith("_test")) {
    throw new Error("resetDb refused: DATABASE_URL is not a *_test database");
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** TOTP secret of admins made by createUser (generate codes with otplib's authenticator). */
export const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

/** Staff roles are created already enrolled in 2FA unless `enrolled: false`. */
export async function createUser(
  options: {
    email?: string;
    role?: Role;
    disabled?: boolean;
    verified?: boolean;
    enrolled?: boolean;
  } = {},
) {
  const role = options.role ?? "CUSTOMER";
  const enrolled = role !== "CUSTOMER" && options.enrolled !== false;
  return prisma.user.create({
    data: {
      email: options.email ?? `user-${Math.random().toString(36).slice(2)}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Ada",
      lastName: "Cook",
      role,
      disabledAt: options.disabled ? new Date() : null,
      emailVerifiedAt: options.verified === false ? null : new Date(),
      totpSecretEnc: enrolled ? sealSecret(TEST_TOTP_SECRET) : null,
      totpEnabledAt: enrolled ? new Date() : null,
    },
  });
}

/** Returns "name=value" for a Set-Cookie header, for sending back on the next request. */
export function cookieFrom(res: Response, name: string): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith(`${name}=`))?.split(";")[0];
}

export function setCookieHeader(res: Response, name: string): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith(`${name}=`));
}

/** Pulls the token out of the first link in the latest email. */
export function tokenFromEmail(text: string): string {
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No token link in email:\n${text}`);
  return match[1];
}

/** Issues an invite for an existing staff user and accepts it with PASSWORD. */
export async function acceptInviteFor(app: Express, userId: string): Promise<Response> {
  const token = await createAdminInvite(prisma, userId);
  return request(app).post("/api/v1/admin/auth/accept-invite").send({ token, password: PASSWORD });
}

/** A raw invite token for an existing staff user. */
export const inviteTokenFor = (userId: string): Promise<string> =>
  createAdminInvite(prisma, userId);

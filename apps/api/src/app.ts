import { localeMiddleware } from "./lib/locale";
import os from "node:os";
import path from "node:path";
import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import type { Redis } from "ioredis";
import { fail } from "@hp/contracts";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { createSmtpMailer, type Mailer } from "./lib/mailer";
import {
  createFakeGateway,
  createStripeGateway,
  createAmwalGateway,
  type PaymentGateway,
} from "./lib/payments";
import { prisma } from "./lib/prisma";
import { memoryLimiters, rateLimit, type LimiterFactory } from "./lib/rate-limit";
import { createInlineReportQueue, type ReportQueue } from "./lib/report-queue";
import {
  createLocalReportStorage,
  createR2ReportStorage,
  type ReportStorage,
} from "./lib/report-storage";
import { safeErrorFields } from "./lib/safe-error";
import { sentryErrorHandler } from "./lib/sentry";
import { createFakeStorage, createR2Storage, type ImageStorage } from "./lib/storage";
import { resolveClientAddress } from "./lib/client-address";
import { createErrorHandler } from "./middleware/error-handler";
import { webhookRouter } from "./modules/payments/webhook.routes";
import { runReport } from "./modules/reports/report-runner";
import { apiRouter } from "./routes";

const ONE_MINUTE = 60;
const FIFTEEN_MINUTES = 15 * 60;
const ONE_HOUR = 60 * 60;
/** Storefront SSR requests that present the internal token without a shopper address. */
export const INTERNAL_REQUESTS_PER_MINUTE = 1_000;

/** Requests allowed per window. "PerAccount"/"PerUser" limits are keyed by account, the rest by client IP. */
export const DEFAULT_LIMITS = {
  general: 100, // per IP per minute
  internal: INTERNAL_REQUESTS_PER_MINUTE, // one shared bucket for token-only SSR reads
  login: 5, // per IP per minute: customer login and register
  loginPerAccount: 10, // per email per 15 minutes: stops credential stuffing from many IPs
  adminLogin: 5, // per IP per minute: admin password step
  passwordReset: 5, // per IP per 15 minutes
  admin2fa: 5, // per IP per minute
  admin2faPerUser: 5, // per admin per 15 minutes: stops distributed TOTP guessing
  checkout: 20, // per IP per 15 minutes: each checkout holds stock for a while
  coupon: 10, // per IP per minute: stops guessing coupon codes
  orderLookup: 10, // per IP per minute: guest order lookup by token
  reportCreate: 10, // per admin per 15 minutes: report exports are heavy queries
  checkoutStatus: 60, // per IP per minute: the return page polls while a payment settles
  adminPasswordReset: 20, // per admin per hour: reset links sent to other users
  // Not rate limits but caps on concurrent state: unpaid checkouts that may hold stock at once.
  openCheckoutsPerEmail: 3,
  openCheckoutsPerClient: 10, // per IP or IPv6 /64; NAT can put a household behind one
};
export type Limits = typeof DEFAULT_LIMITS;

export type AppOptions = {
  mailer: Mailer;
  limiterFactory: LimiterFactory;
  redis: Redis | null;
  limits: Partial<Limits>;
  payments: PaymentGateway;
  storage: ImageStorage;
  reportStorage: ReportStorage;
  /** Defaults to generating in-process; server.ts passes the Redis queue when configured. */
  reportQueue: ReportQueue;
};

/** The configured card provider (env validation refuses "fake" and Amwal UAT in production). */
export function paymentsFromEnv(): PaymentGateway {
  switch (env.PAYMENT_PROVIDER) {
    case "amwal":
      return createAmwalGateway({
        env: env.AMWAL_ENV,
        merchantId: env.AMWAL_MERCHANT_ID!,
        terminalId: env.AMWAL_TERMINAL_ID!,
        secureKey: env.AMWAL_SECURE_KEY!,
        launcherBase: `${env.API_PUBLIC_URL}/api/v1/checkout/amwal-pay`,
        linkSecret: env.COOKIE_SECRET,
        // The payment link outlives our stock hold; late payments are refunded automatically.
        linkMinutes: env.RESERVATION_TTL_MINUTES,
      });
    case "stripe":
      return createStripeGateway(env.STRIPE_SECRET_KEY!, env.STRIPE_WEBHOOK_SECRET!);
    default:
      return createFakeGateway(`${env.API_PUBLIC_URL}/api/v1/checkout/fake-pay`);
  }
}

function storageFromEnv(): ImageStorage {
  return env.IMAGE_STORAGE === "r2"
    ? createR2Storage({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_BUCKET!,
        cdnBaseUrl: env.CDN_BASE_URL,
      })
    : createFakeStorage(env.CDN_BASE_URL);
}

/** Private storage for report exports (env validation refuses "fake" in production). */
export function reportStorageFromEnv(): ReportStorage {
  return env.REPORT_STORAGE === "r2"
    ? createR2ReportStorage({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_REPORTS_BUCKET!,
      })
    : createLocalReportStorage({
        dir: env.REPORTS_DIR ?? path.join(os.tmpdir(), "hearth-and-pan-reports"),
        publicBaseUrl: env.API_PUBLIC_URL,
        secret: env.COOKIE_SECRET,
      });
}

/** Token-only internal requests use their own bucket; everyone else is limited per address. */
const generalLimit =
  (perAddress: RequestHandler, internal: RequestHandler): RequestHandler =>
  (req, res, next) =>
    req.clientKind === "internal" ? internal(req, res, next) : perAddress(req, res, next);

/** Builds the Express app. server.ts and the integration tests both call this. */
export function createApp(options: Partial<AppOptions> = {}): Express {
  const mailer = options.mailer ?? createSmtpMailer(env.SMTP_URL, env.MAIL_FROM, logger);
  const factory = options.limiterFactory ?? memoryLimiters;
  const payments = options.payments ?? paymentsFromEnv();
  const storage = options.storage ?? storageFromEnv();
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const reportStorage = options.reportStorage ?? reportStorageFromEnv();
  const reportQueue =
    options.reportQueue ??
    createInlineReportQueue(
      (id) => runReport({ db: prisma, storage: reportStorage }, id),
      (err, reportId) => logger.error({ err: safeErrorFields(err), reportId }, "report run failed"),
    );
  const limiter = (keyPrefix: string, points: number, durationSec: number) =>
    factory({ keyPrefix, points, durationSec });

  const app = express();
  // Number of reverse proxies in front of the API (Render = 1; Cloudflare + Render = 2).
  // Getting this right is what makes req.ip, and so every per-IP limit, trustworthy.
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");

  // Development without R2: serves the photos import-albaleed.ts (and "fake" storage) wrote
  // under apps/api/.dev-cdn. Before helmet, whose same-origin resource policy would block the
  // storefront (another origin) from showing them. Never mounted in production.
  if (env.NODE_ENV !== "production" && env.IMAGE_STORAGE === "fake") {
    app.use(
      "/dev-cdn",
      express.static(path.resolve(process.cwd(), ".dev-cdn"), { fallthrough: false }),
    );
  }
  app.use(helmet());
  app.use(cors({ origin: [env.WEB_ORIGIN, env.ADMIN_ORIGIN], credentials: true }));
  // Before any limiter: decides which address per-IP limits key on (D-04, SSR traffic).
  app.use(resolveClientAddress(env.INTERNAL_API_TOKEN));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== "test" }));
  // Before express.json(): webhook signatures are verified over the raw body.
  app.use("/api/v1/webhooks", webhookRouter({ db: prisma, payments, mailer }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(localeMiddleware);

  app.use(
    "/api/v1",
    // Default: nothing is cacheable. Public catalog routes opt in explicitly.
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    generalLimit(
      rateLimit(limiter("rl:general", limits.general, ONE_MINUTE)),
      rateLimit(limiter("rl:internal", limits.internal, ONE_MINUTE), () => "internal"),
    ),
    apiRouter({
      mailer,
      payments,
      storage,
      redis: options.redis ?? null,
      reports: { storage: reportStorage, queue: reportQueue },
      checkoutCaps: {
        openPerEmail: limits.openCheckoutsPerEmail,
        openPerClient: limits.openCheckoutsPerClient,
      },
      limiters: {
        login: limiter("rl:login", limits.login, ONE_MINUTE),
        loginPerAccount: limiter("rl:login-acct", limits.loginPerAccount, FIFTEEN_MINUTES),
        adminLogin: limiter("rl:admin-login", limits.adminLogin, ONE_MINUTE),
        passwordReset: limiter("rl:reset", limits.passwordReset, FIFTEEN_MINUTES),
        admin2fa: limiter("rl:2fa", limits.admin2fa, ONE_MINUTE),
        admin2faPerUser: limiter("rl:2fa-user", limits.admin2faPerUser, FIFTEEN_MINUTES),
        checkout: limiter("rl:checkout", limits.checkout, FIFTEEN_MINUTES),
        coupon: limiter("rl:coupon", limits.coupon, ONE_MINUTE),
        orderLookup: limiter("rl:order-lookup", limits.orderLookup, ONE_MINUTE),
        reportCreate: limiter("rl:report", limits.reportCreate, FIFTEEN_MINUTES),
        checkoutStatus: limiter("rl:checkout-status", limits.checkoutStatus, ONE_MINUTE),
        adminPasswordReset: limiter("rl:admin-reset", limits.adminPasswordReset, ONE_HOUR),
      },
    }),
  );

  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json(fail("NOT_FOUND", "Not found."));
  });
  sentryErrorHandler(app); // reports 5xx to Sentry (when enabled) before our envelope handler
  app.use(createErrorHandler(logger));
  return app;
}

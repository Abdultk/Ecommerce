import { z } from "zod";

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    /** Reverse proxies in front of the API: 1 on Render, 2 with Cloudflare in front of Render. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    /** "memory" is for tests and single-process local runs only */
    RATE_LIMIT_STORE: z.enum(["redis", "memory"]).default("redis"),
    JWT_ACCESS_SECRET: z.string().min(32),
    REFRESH_TOKEN_PEPPER: z.string().min(32),
    /**
     * Shared with the storefront server. Requests that present it (X-Internal-Token) may name
     * the end user's address in X-HP-Client-IP for per-IP rate limits. Required in production.
     */
    INTERNAL_API_TOKEN: z.string().min(32).optional(),
    /** Derives guest order-lookup tokens; rotating it invalidates every emailed order link. */
    ORDER_LOOKUP_SECRET: z.string().min(32),
    /** How long an unpaid checkout holds stock before the worker releases it. */
    RESERVATION_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    /** Signs the guest-cart cookie */
    COOKIE_SECRET: z.string().min(32),
    TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Must be 32 bytes as 64 hex characters"),
    /** Storefront origin, e.g. https://www.hearthandpan.com */
    WEB_ORIGIN: z.string().url(),
    /** Admin origin, e.g. https://admin.hearthandpan.com */
    ADMIN_ORIGIN: z.string().url(),
    SMTP_URL: z.string().url().optional(),
    /** Where low-stock alerts go after a sale; unset disables them. */
    LOW_STOCK_ALERT_EMAIL: z.string().email().optional(),
    /**
     * Card payments. "amwal" (Amwal Pay SmartBox), "stripe" (kept), or "fake" for local dev and
     * tests (refused in production). The old name PAYMENTS_PROVIDER is still read.
     */
    PAYMENT_PROVIDER: z.enum(["amwal", "stripe", "fake"]).default("fake"),
    /** Amwal Pay environment; production refuses "uat". */
    AMWAL_ENV: z.enum(["uat", "production"]).default("uat"),
    AMWAL_MERCHANT_ID: z.string().regex(/^\d+$/, "Digits only").optional(),
    AMWAL_TERMINAL_ID: z.string().regex(/^\d+$/, "Digits only").optional(),
    /** The merchant secure key from Amwal (hex). Also verifies notifications from Amwal. */
    AMWAL_SECURE_KEY: z
      .string()
      .regex(/^(?:[0-9a-fA-F]{2}){16,}$/, "Hex string from Amwal Pay")
      .optional(),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    /** "fake" issues placeholder upload URLs (local dev); refused in production. */
    IMAGE_STORAGE: z.enum(["r2", "fake"]).default("fake"),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    CDN_BASE_URL: z.string().url().default("http://localhost:4000/dev-cdn"),
    /** "fake" keeps report files on local disk behind an HMAC-signed API route; refused in production. */
    REPORT_STORAGE: z.enum(["r2", "fake"]).default("fake"),
    /** Private bucket for report exports (never the public image bucket). */
    R2_REPORTS_BUCKET: z.string().min(1).optional(),
    /** Local directory for fake report storage; defaults to the OS temp dir. */
    REPORTS_DIR: z.string().min(1).optional(),
    /** Public base URL of this API, used for fake-storage download links. */
    API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
    MAIL_FROM: z.string().min(3).default("PAISLEY art <no-reply@localhost>"),
    /** Error reporting for the API and worker; unset disables Sentry entirely. */
    SENTRY_DSN: z.string().url().optional(),
    /** Set by Render; used as the Sentry release. */
    RENDER_GIT_COMMIT: z.string().min(1).max(64).optional(),
    /**
     * Public base URL of the Next.js storefront, used by the API to fire on-demand ISR
     * revalidation after admin mutations (e.g. https://www.paisleyart.com). Optional in
     * dev; should be set in production together with REVALIDATE_SECRET.
     */
    WEB_REVALIDATE_URL: z.string().url().optional(),
    /**
     * Shared secret between the API and the storefront's /api/revalidate Route Handler.
     * Must match REVALIDATE_SECRET in apps/web's environment.
     */
    REVALIDATE_SECRET: z.string().min(32).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.RATE_LIMIT_STORE === "redis" && !e.REDIS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "Required when RATE_LIMIT_STORE=redis",
      });
    }
    const missing = (keys: (keyof typeof e)[], why: string) => {
      for (const key of keys) {
        if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `Required when ${why}` });
      }
    };
    if (e.PAYMENT_PROVIDER === "stripe") {
      missing(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], "PAYMENT_PROVIDER=stripe");
    }
    if (e.PAYMENT_PROVIDER === "amwal") {
      missing(
        ["AMWAL_MERCHANT_ID", "AMWAL_TERMINAL_ID", "AMWAL_SECURE_KEY"],
        "PAYMENT_PROVIDER=amwal",
      );
    }
    if (e.IMAGE_STORAGE === "r2") {
      missing(
        ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"],
        "IMAGE_STORAGE=r2",
      );
    }
    if (e.REPORT_STORAGE === "r2") {
      missing(
        ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_REPORTS_BUCKET"],
        "REPORT_STORAGE=r2",
      );
    }
    // Revalidation pair: both required when either is set.
    if (e.WEB_REVALIDATE_URL && !e.REVALIDATE_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["REVALIDATE_SECRET"],
        message: "Required when WEB_REVALIDATE_URL is set",
      });
    }
    if (e.REVALIDATE_SECRET && !e.WEB_REVALIDATE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["WEB_REVALIDATE_URL"],
        message: "Required when REVALIDATE_SECRET is set",
      });
    }
    if (e.NODE_ENV === "production") {
      // Each secret protects something different; one leak must not unlock the others.
      const secrets = [
        "JWT_ACCESS_SECRET",
        "REFRESH_TOKEN_PEPPER",
        "COOKIE_SECRET",
        "ORDER_LOOKUP_SECRET",
        "INTERNAL_API_TOKEN",
      ] as const;
      secrets.forEach((a, i) =>
        secrets.slice(i + 1).forEach((b) => {
          if (e[a] && e[a] === e[b]) {
            ctx.addIssue({ code: "custom", path: [b], message: `must differ from ${a}` });
          }
        }),
      );
      if (e.PAYMENT_PROVIDER === "fake") {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_PROVIDER"],
          message: "Must be amwal or stripe in production",
        });
      }
      if (e.PAYMENT_PROVIDER === "amwal" && e.AMWAL_ENV !== "production") {
        ctx.addIssue({
          code: "custom",
          path: ["AMWAL_ENV"],
          message: "Must be production in production",
        });
      }
      if (e.IMAGE_STORAGE !== "r2") {
        ctx.addIssue({
          code: "custom",
          path: ["IMAGE_STORAGE"],
          message: "Must be r2 in production",
        });
      }
      if (e.REPORT_STORAGE !== "r2") {
        ctx.addIssue({
          code: "custom",
          path: ["REPORT_STORAGE"],
          message: "Must be r2 in production",
        });
      }
      if (e.RATE_LIMIT_STORE !== "redis") {
        ctx.addIssue({
          code: "custom",
          path: ["RATE_LIMIT_STORE"],
          message: "Must be redis in production",
        });
      }
      if (!e.INTERNAL_API_TOKEN) {
        ctx.addIssue({
          code: "custom",
          path: ["INTERNAL_API_TOKEN"],
          message: "Required in production",
        });
      }
      if (!e.SMTP_URL) {
        ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "Required in production" });
      }
      if (!e.WEB_REVALIDATE_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["WEB_REVALIDATE_URL"],
          message: "Required in production for on-demand ISR revalidation",
        });
      }
      if (!e.REVALIDATE_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["REVALIDATE_SECRET"],
          message: "Required in production for on-demand ISR revalidation",
        });
      }
    }
  });

export type Env = z.infer<typeof Env>;

/** Validates the environment once at startup and fails fast with every problem listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Readonly<Env> {
  // Treat `KEY=` (empty) as unset, so optional settings can be left blank in .env files.
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  // Legacy name (before Phase 3b): honoured only when the new one is absent.
  const withAlias =
    present.PAYMENT_PROVIDER === undefined && present.PAYMENTS_PROVIDER !== undefined
      ? { ...present, PAYMENT_PROVIDER: present.PAYMENTS_PROVIDER }
      : present;
  const parsed = Env.safeParse(withAlias);
  if (!parsed.success) {
    const problems = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([key, messages]) => `  ${key}: ${messages?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return Object.freeze(parsed.data);
}

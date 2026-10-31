// Shared E2E settings for the server scripts, Playwright config and helpers.
// Reads e2e/.env.e2e when present, otherwise e2e/.env.e2e.example. Real environment
// variables always win, so CI can override any value.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = path.resolve(E2E_DIR, "..");

function parseEnvFile(file) {
  const values = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    values[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return values;
}

const envFile = [".env.e2e", ".env.e2e.example"]
  .map((name) => path.join(E2E_DIR, name))
  .find((file) => existsSync(file));
const fileValues = envFile ? parseEnvFile(envFile) : {};
const read = (key, fallback) => process.env[key] ?? fileValues[key] ?? fallback;

export const settings = Object.freeze({
  databaseUrl: read(
    "E2E_DATABASE_URL",
    "postgresql://hp:hp_local_dev_only@127.0.0.1:5442/hearthandpan_e2e_test",
  ),
  apiPort: Number(read("E2E_API_PORT", "4100")),
  webPort: Number(read("E2E_WEB_PORT", "3100")),
  adminPort: Number(read("E2E_ADMIN_PORT", "3101")),
  smtpUrl: read("E2E_SMTP_URL", "smtp://127.0.0.1:1035"),
  mailpitUrl: read("E2E_MAILPIT_URL", "http://127.0.0.1:8035").replace(/\/+$/, ""),
  buildMode: read("E2E_BUILD_MODE", "copy"),
  skipBuild: read("E2E_SKIP_BUILD", "0") === "1",
});

export const urls = Object.freeze({
  api: `http://localhost:${settings.apiPort}/api/v1`,
  apiOrigin: `http://localhost:${settings.apiPort}`,
  web: `http://localhost:${settings.webPort}`,
  admin: `http://localhost:${settings.adminPort}`,
});

/** Refuses any database that isn't clearly the dedicated E2E one. */
export function assertE2eDatabase(url = settings.databaseUrl) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_e2e_test")) {
    throw new Error(
      `E2E only runs against a database whose name ends in _e2e_test, got "${name}".`,
    );
  }
  return name;
}

/**
 * Product image CDN for the E2E stack. Production builds of both Next apps refuse the
 * fixture host (cdn.example.test) and plain http, so a fictional https host is used. Fake
 * image storage presigns uploads to `${CDN_BASE_URL}/fake-upload/<key>`; tests stub that
 * host with page.route, so nothing leaves the machine.
 */
export const FAKE_CDN_ORIGIN = "https://cdn.e2e.example.test";
export const FAKE_CDN_BASE_URL = `${FAKE_CDN_ORIGIN}/e2e-cdn`;
/** Host the shared sample catalog (and so the seed) uses for its images. */
export const FIXTURE_CDN_ORIGIN = "https://cdn.example.test";

const random = (bytes) => randomBytes(bytes).toString("base64url");

/**
 * Shared secret the storefront sends as X-Internal-Token so the API rate-limits SSR calls
 * per shopper (D-04). The API and web servers are separate processes, so the first module
 * load (the Playwright config, or servers.mjs) generates it and children inherit it.
 */
process.env.E2E_INTERNAL_API_TOKEN ||= random(48);
const INTERNAL_API_TOKEN = process.env.E2E_INTERNAL_API_TOKEN;

/**
 * Environment for the API process (and for the seed script, which loads the API's env
 * module). Secrets are random per call: nothing in the E2E database outlives a run's
 * sessions, and each run enrolls fresh admins.
 */
export function apiEnv(extra = {}) {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "warn",
    PORT: String(settings.apiPort),
    DATABASE_URL: settings.databaseUrl,
    // No REDIS_URL: email goes straight to Mailpit over SMTP and limits stay in memory,
    // so no worker process is needed and nothing is shared with the dev Redis.
    REDIS_URL: "",
    RATE_LIMIT_STORE: "memory",
    // One trusted hop lets each test present its own client IP (X-Forwarded-For), so the
    // per-IP limits apply per test instead of to the whole suite. See support/net.ts.
    TRUST_PROXY_HOPS: "1",
    JWT_ACCESS_SECRET: random(48),
    REFRESH_TOKEN_PEPPER: random(48),
    ORDER_LOOKUP_SECRET: random(48),
    COOKIE_SECRET: random(48),
    INTERNAL_API_TOKEN,
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    WEB_ORIGIN: urls.web,
    ADMIN_ORIGIN: urls.admin,
    SMTP_URL: settings.smtpUrl,
    API_PUBLIC_URL: urls.apiOrigin,
    REPORT_STORAGE: "fake",
    REPORTS_DIR: path.join(E2E_DIR, ".apps", "reports"),
    MAIL_FROM: "Hearth & Pan E2E <orders@e2e.example.test>",
    PAYMENTS_PROVIDER: "fake",
    IMAGE_STORAGE: "fake",
    // The specs shop for the fixture products, which only the opt-in demo seed creates.
    SEED_DEMO_CATALOG: "true",
    CDN_BASE_URL: FAKE_CDN_BASE_URL,
    ...extra,
  };
}

/** Build-time env for the Next apps (NEXT_PUBLIC_* is inlined by `next build`). */
export function nextEnv(app) {
  const common = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_API_URL: urls.api,
    NEXT_PUBLIC_API_MOCKING: "",
    NEXT_PUBLIC_CDN_URL: FAKE_CDN_ORIGIN,
  };
  if (app === "web") {
    return {
      ...common,
      NEXT_PUBLIC_SITE_URL: urls.web,
      INTERNAL_API_TOKEN,
      // No Cloudflare here: Playwright hits `next start` directly with one X-Forwarded-For.
      CLIENT_IP_HEADER: "x-forwarded-for",
      TRUSTED_PROXY_HOPS: "1",
      // Empty: the fake payment provider never needs Stripe.js.
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
      // The fake card provider's hosted page is plain http on localhost.
      NEXT_PUBLIC_E2E_LOCAL_PAYMENT_PAGE: "true",
    };
  }
  // The admin's production build also needs an exact https upload origin.
  return { ...common, NEXT_PUBLIC_UPLOAD_ORIGIN: FAKE_CDN_ORIGIN };
}

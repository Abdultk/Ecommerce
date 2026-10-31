import { describe, expect, it } from "vitest";
import { loadEnv } from "./env-schema";

const secret = (label: string) => `${label}-0123456789abcdef0123456789abcdef`;

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example.test:5432/hp",
  REDIS_URL: "redis://cache.example.test:6379",
  RATE_LIMIT_STORE: "redis",
  WEB_REVALIDATE_URL: "https://shop.example.test/api/revalidate",
  REVALIDATE_SECRET: secret("revalidate"),
  JWT_ACCESS_SECRET: secret("jwt"),
  REFRESH_TOKEN_PEPPER: secret("pepper"),
  COOKIE_SECRET: secret("cookie"),
  ORDER_LOOKUP_SECRET: secret("lookup"),
  INTERNAL_API_TOKEN: secret("internal"),
  TOTP_ENCRYPTION_KEY: "a".repeat(64),
  WEB_ORIGIN: "https://www.example.test",
  ADMIN_ORIGIN: "https://admin.example.test",
  SMTP_URL: "smtp://mail.example.test:587",
  PAYMENTS_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  IMAGE_STORAGE: "r2",
  REPORT_STORAGE: "r2",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "key",
  R2_BUCKET: "images",
  R2_REPORTS_BUCKET: "reports",
};

describe("loadEnv", () => {
  it("accepts a complete production configuration", () => {
    expect(loadEnv(production).NODE_ENV).toBe("production");
  });

  it("refuses reused secrets in production, naming the clashing pair", () => {
    const reused = { ...production, ORDER_LOOKUP_SECRET: production.COOKIE_SECRET };
    expect(() => loadEnv(reused)).toThrow(
      /ORDER_LOOKUP_SECRET.*COOKIE_SECRET|COOKIE_SECRET.*ORDER_LOOKUP_SECRET/s,
    );
    const internal = { ...production, INTERNAL_API_TOKEN: production.JWT_ACCESS_SECRET };
    expect(() => loadEnv(internal)).toThrow(/must differ/);
  });

  it("allows reuse outside production (local convenience)", () => {
    const dev = {
      ...production,
      NODE_ENV: "development",
      ORDER_LOOKUP_SECRET: production.COOKIE_SECRET,
    };
    expect(loadEnv(dev).NODE_ENV).toBe("development");
  });

  describe("payment provider (Phase 3b)", () => {
    const { PAYMENTS_PROVIDER: _legacy, ...base } = production;
    const amwal = {
      ...base,
      PAYMENT_PROVIDER: "amwal",
      AMWAL_ENV: "production",
      AMWAL_MERCHANT_ID: "12345",
      AMWAL_TERMINAL_ID: "67890",
      AMWAL_SECURE_KEY: "9FFA1F36D6E8A136482DF921E856709226DE5A974DB2673F84DB79DA788F7E19",
    };

    it("accepts Amwal in production", () => {
      expect(loadEnv(amwal)).toMatchObject({
        PAYMENT_PROVIDER: "amwal",
        AMWAL_ENV: "production",
      });
    });

    it("refuses the Amwal UAT environment in production", () => {
      expect(() => loadEnv({ ...amwal, AMWAL_ENV: "uat" })).toThrow(/AMWAL_ENV/);
    });

    it("allows UAT outside production and defaults to it", () => {
      const { AMWAL_ENV: _env, ...dev } = { ...amwal, NODE_ENV: "development" };
      expect(loadEnv(dev).AMWAL_ENV).toBe("uat");
    });

    it("requires every Amwal setting when Amwal is selected", () => {
      const { AMWAL_SECURE_KEY: _w, ...missing } = amwal;
      expect(() => loadEnv(missing)).toThrow(/AMWAL_SECURE_KEY/);
    });

    it("refuses the fake provider in production", () => {
      expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: "fake" })).toThrow(/PAYMENT_PROVIDER/);
    });

    it("still reads the legacy PAYMENTS_PROVIDER name", () => {
      expect(loadEnv(production).PAYMENT_PROVIDER).toBe("stripe");
    });

    it("prefers PAYMENT_PROVIDER over the legacy name", () => {
      expect(loadEnv({ ...amwal, PAYMENTS_PROVIDER: "stripe" }).PAYMENT_PROVIDER).toBe("amwal");
    });

    it("defaults to the fake provider in development", () => {
      const { NODE_ENV: _n, ...dev } = base;
      expect(loadEnv(dev).PAYMENT_PROVIDER).toBe("fake");
    });
  });

  it("requires INTERNAL_API_TOKEN in production", () => {
    const { INTERNAL_API_TOKEN: _omit, ...missing } = production;
    expect(() => loadEnv(missing)).toThrow(/INTERNAL_API_TOKEN/);
  });
});

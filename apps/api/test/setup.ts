// Runs in each test worker before any test file imports the app, so env.ts sees these values.
// All values are test-only and never used outside the integration suite.
const defaults: Record<string, string> = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://hp:hp_local_dev_only@localhost:5442/hearthandpan_test",
  RATE_LIMIT_STORE: "memory",
  JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
  REFRESH_TOKEN_PEPPER: "test-refresh-pepper-0123456789abcdef012345678",
  COOKIE_SECRET: "test-cookie-secret-0123456789abcdef0123456789",
  ORDER_LOOKUP_SECRET: "test-order-lookup-secret-0123456789abcdef0123",
  INTERNAL_API_TOKEN: "test-internal-api-token-0123456789abcdef01234",
  TOTP_ENCRYPTION_KEY: "0".repeat(63) + "1",
  WEB_ORIGIN: "http://localhost:3000",
  ADMIN_ORIGIN: "http://localhost:3001",
};

for (const [key, value] of Object.entries(defaults)) {
  // DATABASE_URL is always forced to the test database.
  if (key === "DATABASE_URL" || process.env[key] === undefined) process.env[key] = value;
}
process.env.NODE_ENV = "test";

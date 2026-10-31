import { defineConfig } from "vitest/config";

// Unit tests: pure logic only, no database. Integration tests live in test/ (vitest.int.config.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/modules/cart/pricing.ts",
        "src/modules/cart/coupons.ts",
        "src/lib/crypto.ts",
        "src/middleware/error-handler.ts",
        "src/lib/fingerprint.ts",
        "src/lib/safe-error.ts",
        "src/lib/sentry.ts",
        "src/modules/reports/csv.ts",
      ],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});

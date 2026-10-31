import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // The contract is the integration point for every app: hold it to a higher bar.
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
    },
  },
});

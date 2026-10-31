import { defineConfig } from "vitest/config";

// Integration tests run the real Express app against a real Postgres test database.
// Files run one at a time because they share that database.
export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    // Each test drives the real app through Postgres; under a full run on a loaded machine a
    // single multi-request test can take well over 20 s, so leave headroom.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage-int",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/**/*.test.ts", "src/types/**"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});

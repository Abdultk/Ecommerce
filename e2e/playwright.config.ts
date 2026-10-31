import { defineConfig, devices } from "@playwright/test";
import { urls } from "./scripts/env.mjs";

const CI = Boolean(process.env.CI);
// Production builds take a few minutes each on a cold cache.
const BUILD_TIMEOUT_MS = 10 * 60_000;

/**
 * E2E suite: API (:4100), storefront (:3100) and admin (:3101) against the dedicated
 * hearthandpan_e2e_test database. `pnpm --filter @hp/e2e test:e2e` builds and starts all
 * three; running servers on those ports are reused locally (never in CI).
 */
export default defineConfig({
  testDir: ".",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Modest parallelism: storefront SSR shares one per-IP API limit (defect D-04).
  workers: 2,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: urls.web,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /setup\/.*\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /tests\/.*\.spec\.ts/,
      testIgnore: /a11y\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Blueprint 8.1: WebKit mobile for the storefront-only paths. Needs
    // `playwright install webkit`, so it is opt-in (E2E_WEBKIT=1, set in CI).
    ...(process.env.E2E_WEBKIT === "1"
      ? [
          {
            name: "mobile-webkit",
            testMatch: /tests\/(catalog|cart|checkout)\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["iPhone 13"] },
          },
        ]
      : []),
    {
      name: "a11y",
      testMatch: /tests\/a11y\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // E2E_NO_WEBSERVER=1: the servers were started separately (`node scripts/servers.mjs all`).
  webServer:
    process.env.E2E_NO_WEBSERVER === "1"
      ? undefined
      : [
          {
            command: "node scripts/servers.mjs api",
            url: `${urls.api}/health`,
            reuseExistingServer: !CI,
            // migrate deploy waits if another prisma CLI holds the engine; be generous.
            timeout: BUILD_TIMEOUT_MS,
            stdout: "pipe",
            stderr: "pipe",
          },
          {
            command: "node scripts/servers.mjs web",
            url: `${urls.web}/robots.txt`,
            reuseExistingServer: !CI,
            timeout: BUILD_TIMEOUT_MS,
            stdout: "pipe",
            stderr: "pipe",
          },
          {
            command: "node scripts/servers.mjs admin",
            url: `${urls.admin}/login`,
            reuseExistingServer: !CI,
            timeout: BUILD_TIMEOUT_MS,
            stdout: "pipe",
            stderr: "pipe",
          },
        ],
});

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://hp:hp_local_dev_only@localhost:5442/hearthandpan_test";

/**
 * Brings the test database up to date with `migrate deploy` (non-destructive; the same
 * command CI and production use). Tests empty their tables themselves via resetDb().
 */
export default function setup(): void {
  if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
    throw new Error(
      `Integration tests only run against a database whose name ends in _test, got: ${TEST_DATABASE_URL}`,
    );
  }
  execFileSync(
    process.execPath,
    [path.join(apiDir, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: apiDir, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "pipe" },
  );
}

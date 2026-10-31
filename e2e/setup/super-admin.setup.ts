import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { ROOT_DIR, apiEnv, assertE2eDatabase } from "../scripts/env.mjs";
import { Api, enrollFromInvite } from "../support/api";
import { AUTH_DIR, SUPER_ADMIN_FILE, urls } from "../support/config";
import { uniqueEmail } from "../support/data";

const API_DIR = path.join(ROOT_DIR, "apps", "api");

/**
 * Creates this run's SUPER_ADMIN the way production does: the seed prints a one-time
 * invite link, which is redeemed (password + TOTP enrollment) through the API. Tests use
 * its access token only to arrange data (invite staff, create products, look up orders).
 */
setup("enroll a super admin from the seed invite", async () => {
  assertE2eDatabase();
  const email = uniqueEmail("super");
  const tsx = createRequire(path.join(API_DIR, "package.json")).resolve("tsx/cli");
  const seed = spawnSync(process.execPath, [tsx, "prisma/seed.ts"], {
    cwd: API_DIR,
    env: { ...process.env, ...apiEnv({ SEED_ADMIN_EMAIL: email }) },
    encoding: "utf8",
  });
  expect(seed.status, seed.stderr).toBe(0);
  const output = `${seed.stdout}\n${seed.stderr}`;
  const inviteLink = output.match(/https?:\/\/\S+\/accept-invite#token=\S+/)?.[0];
  expect(inviteLink, output).toBeTruthy();
  expect(inviteLink!.startsWith(urls.admin)).toBe(true);

  const api = await Api.create();
  try {
    const admin = await enrollFromInvite(api, email, inviteLink!, "SUPER_ADMIN");
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(SUPER_ADMIN_FILE, JSON.stringify(admin, null, 2));
  } finally {
    await api.dispose();
  }
});

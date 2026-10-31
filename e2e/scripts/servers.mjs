#!/usr/bin/env node
// Starts the E2E servers. Playwright's webServer runs one per app:
//   node scripts/servers.mjs api     migrate deploy + seed the E2E database, then serve :4100
//   node scripts/servers.mjs web     next build + next start on :3100
//   node scripts/servers.mjs admin   next build + next start on :3101
// `node scripts/servers.mjs all` runs all three (for k6/ZAP or manual exploration).
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  E2E_DIR,
  FAKE_CDN_ORIGIN,
  FIXTURE_CDN_ORIGIN,
  ROOT_DIR,
  apiEnv,
  assertE2eDatabase,
  nextEnv,
  settings,
} from "./env.mjs";

const API_DIR = path.join(ROOT_DIR, "apps", "api");
const requireFromApi = createRequire(path.join(API_DIR, "package.json"));
const PRISMA_CLI = requireFromApi.resolve("prisma/build/index.js");
const TSX_CLI = requireFromApi.resolve("tsx/cli");

/** Files copied for a snapshot build. Tests, coverage and build output are left behind. */
const NEXT_APP_FILES = [
  "src",
  "public",
  "messages",
  "next.config.ts",
  "next-env.d.ts",
  "package.json",
  "tsconfig.json",
  "postcss.config.mjs",
];

const children = new Set();

function log(app, message) {
  process.stdout.write(`[e2e:${app}] ${message}\n`);
}

function run(app, command, args, options) {
  log(app, `${path.basename(args[0] ?? command)} ${args.slice(1).join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`[e2e:${app}] command failed (${result.status}): ${args.join(" ")}`);
  }
}

function serve(app, command, args, options) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    log(app, `exited (${signal ?? code})`);
    if (children.size === 0 || code) shutdown(code ?? 0);
  });
  return child;
}

function shutdown(code) {
  for (const child of children) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ---------- API ----------

function startApi() {
  const db = assertE2eDatabase();
  const env = { ...process.env, ...apiEnv({ SEED_ADMIN_EMAIL: "" }) };
  // Non-destructive: creates the database if missing and applies pending migrations.
  log("api", `migrate deploy → ${db}`);
  run("api", process.execPath, [PRISMA_CLI, "migrate", "deploy"], { cwd: API_DIR, env });
  // Idempotent demo catalog + WELCOME10. Admins are enrolled per test through invites.
  run("api", process.execPath, [TSX_CLI, "prisma/seed.ts"], { cwd: API_DIR, env });
  // The seed's demo images point at the fixture CDN, which production builds of the
  // storefront refuse (next/image would throw). Serve them from the E2E CDN host instead,
  // as real product images would be. Only touches this run's own E2E database.
  const sql = `UPDATE "ProductImage" SET url = replace(url, '${FIXTURE_CDN_ORIGIN}/', '${FAKE_CDN_ORIGIN}/') WHERE url LIKE '${FIXTURE_CDN_ORIGIN}/%';`;
  run(
    "api",
    process.execPath,
    [PRISMA_CLI, "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
    {
      cwd: API_DIR,
      env,
      input: sql,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  // From source with tsx: never touches apps/api/dist, which other builds own.
  serve("api", process.execPath, [TSX_CLI, "src/server.ts"], { cwd: API_DIR, env });
}

// ---------- Next apps ----------

function isLink(file) {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Removes a linked node_modules tree without ever following a link. */
function removeLinkedModules(dir) {
  if (isLink(dir)) return unlinkSync(dir);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (isLink(file)) unlinkSync(file);
    else removeLinkedModules(file);
  }
  rmdirSync(dir);
}

/**
 * Mirrors apps/<app>/node_modules with one junction per package, each pointing at the
 * package's real path. (A single junction to the folder breaks pnpm's relative links.)
 */
function linkModules(sourceModules, targetModules) {
  mkdirSync(targetModules, { recursive: true });
  for (const entry of readdirSync(sourceModules)) {
    if (entry.startsWith(".")) continue;
    const from = path.join(sourceModules, entry);
    if (entry.startsWith("@") && !isLink(from)) {
      linkModules(from, path.join(targetModules, entry));
      continue;
    }
    symlinkSync(realpathSync(from), path.join(targetModules, entry), "junction");
  }
}

/**
 * Copies the app's sources to e2e/.apps/<app> and links its dependencies, so the E2E build
 * (with E2E-only NEXT_PUBLIC_* values) never overwrites apps/<app>/.next.
 */
function snapshotApp(app) {
  const source = path.join(ROOT_DIR, "apps", app);
  const target = path.join(E2E_DIR, ".apps", app);
  mkdirSync(target, { recursive: true });
  // Unlink first so nothing below ever recurses into a real node_modules.
  removeLinkedModules(path.join(target, "node_modules"));
  for (const entry of readdirSync(target)) {
    if (entry === ".next") continue; // keeps .next/cache for faster rebuilds
    rmSync(path.join(target, entry), { recursive: true, force: true });
  }
  for (const entry of NEXT_APP_FILES) {
    const from = path.join(source, entry);
    if (existsSync(from)) cpSync(from, path.join(target, entry), { recursive: true });
  }
  linkModules(path.join(source, "node_modules"), path.join(target, "node_modules"));
  return target;
}

function startNext(app) {
  const port = app === "web" ? settings.webPort : settings.adminPort;
  const appDir =
    settings.buildMode === "inplace" ? path.join(ROOT_DIR, "apps", app) : snapshotOrReuse(app);
  const nextCli = createRequire(path.join(ROOT_DIR, "apps", app, "package.json")).resolve(
    "next/dist/bin/next",
  );
  const env = { ...process.env, ...nextEnv(app) };
  if (!settings.skipBuild) run(app, process.execPath, [nextCli, "build"], { cwd: appDir, env });
  serve(app, process.execPath, [nextCli, "start", "--port", String(port)], { cwd: appDir, env });
}

function snapshotOrReuse(app) {
  const target = path.join(E2E_DIR, ".apps", app);
  if (settings.skipBuild && existsSync(path.join(target, ".next", "BUILD_ID"))) return target;
  return snapshotApp(app);
}

// ---------- main ----------

const which = process.argv[2] ?? "all";
const starters = { api: startApi, web: () => startNext("web"), admin: () => startNext("admin") };

try {
  if (which === "all") {
    startApi();
    startNext("web");
    startNext("admin");
  } else if (starters[which]) {
    starters[which]();
  } else {
    throw new Error(`Unknown server "${which}". Use api, web, admin or all.`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  shutdown(1);
}

import path from "node:path";
import { E2E_DIR, settings, urls } from "../scripts/env.mjs";

export { settings, urls };

/** Per-run state written by the setup project (gitignored). */
export const AUTH_DIR = path.join(E2E_DIR, ".auth");
export const SUPER_ADMIN_FILE = path.join(AUTH_DIR, "super-admin.json");

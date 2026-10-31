import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every state-changing admin route must write an audit entry. This reads the route sources and
// checks each POST/PATCH/PUT/DELETE handler reaches audit(), directly or through a helper in
// the same file that calls it. A new admin write route that forgets its audit entry fails here.

const modulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Helpers that call audit() on the handler's behalf, by file. */
const AUDITING_HELPERS: Record<string, string[]> = {
  "settings.admin.ts": ["changeSettings("],
  "inventory.admin.ts": ["adjustStock("],
  "password-reset.admin.ts": ["prepareReset("],
};

/** Mutating routes that change nothing worth auditing, with the reason. */
const EXEMPT: Record<string, string> = {
  "products.admin.ts POST /uploads/presign":
    "signs a URL; the product save that uses the key is audited",
};

const ROUTE = /router\.(post|patch|put|delete)\(\s*"([^"]+)"/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    const isAdminRoutes = entry.name.endsWith(".admin.ts") || entry.name === "admin.routes.ts";
    return isAdminRoutes ? [full] : [];
  });
}

type Route = { file: string; label: string; body: string };

function mutatingRoutes(): Route[] {
  return sourceFiles(modulesDir).flatMap((full) => {
    const file = path.basename(full);
    const text = readFileSync(full, "utf8");
    const matches = [...text.matchAll(ROUTE)];
    return matches.map((match, i) => ({
      file,
      label: `${file} ${match[1]!.toUpperCase()} ${match[2]}`,
      body: text.slice(match.index, matches[i + 1]?.index ?? text.length),
    }));
  });
}

describe("admin audit coverage", () => {
  const routes = mutatingRoutes();

  it("finds the admin write routes", () => {
    // Guards against the scan silently matching nothing after a refactor.
    expect(routes.length).toBeGreaterThanOrEqual(25);
  });

  it.each(routes.map((r) => [r.label, r] as const))("%s writes an audit entry", (label, route) => {
    if (EXEMPT[label]) return;
    const helpers = AUDITING_HELPERS[route.file] ?? [];
    const audited = ["audit(", ...helpers].some((call) => route.body.includes(call));
    expect(audited, `${label} changes data but never reaches audit()`).toBe(true);
  });

  it("keeps the exemption list honest", () => {
    const labels = new Set(routes.map((r) => r.label));
    for (const label of Object.keys(EXEMPT)) expect(labels.has(label), label).toBe(true);
  });
});

// Runs after `next build`: prints first-load JS per route against its budget and fails the
// build when a route is over, or when mock-mode code (the MSW worker, src/mocks, the
// sample catalog) made it into the output, or a server-only secret reached a browser chunk.
// Needs Node >= 22.18 (TypeScript type stripping) to import the logic from src/.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { findClientSecrets, findMockLeaks } from "../src/lib/build-output.ts";
import { evaluateBudgets, parseAppBuildManifest } from "../src/lib/bundle-budget.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nextDir = path.join(root, ".next");
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function findFiles(dir, test) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

const manifest = parseAppBuildManifest(
  JSON.parse(readFileSync(path.join(nextDir, "app-build-manifest.json"), "utf8")),
);
const sizes = new Map();
const gzipSize = (file) => {
  if (!sizes.has(file)) {
    sizes.set(file, gzipSync(readFileSync(path.join(nextDir, file)), { level: 9 }).length);
  }
  return sizes.get(file);
};

const report = evaluateBudgets(manifest, gzipSize);
const width = Math.max(...report.map((r) => r.route.length));
process.stdout.write("\nFirst-load JS per route (gzipped, page + layouts):\n");
for (const r of report) {
  const mark = r.over ? "OVER" : "ok";
  process.stdout.write(
    `  ${r.route.padEnd(width)}  ${kb(r.bytes).padStart(9)} / ${kb(r.budget)}  ${mark}\n`,
  );
}

const BUILD_TEXT = /\.(js|mjs|cjs|json|html|rsc|body)$/;
const leaked = [
  ...findFiles(path.join(root, "public"), (name) => name === "mockServiceWorker.js"),
  ...["static", "server"].flatMap((dir) =>
    findFiles(path.join(nextDir, dir), (name) => BUILD_TEXT.test(name)).flatMap((file) =>
      findMockLeaks(path.relative(root, file), readFileSync(file, "utf8")),
    ),
  ),
];
const exposed = findFiles(path.join(nextDir, "static"), (name) => BUILD_TEXT.test(name)).flatMap(
  (file) => findClientSecrets(path.relative(root, file), readFileSync(file, "utf8")),
);
const over = report.filter((r) => r.over);
if (leaked.length)
  process.stderr.write(`\nMock-mode code in the build output:\n  ${leaked.join("\n  ")}\n`);
if (exposed.length)
  process.stderr.write(`\nServer-only secrets in browser chunks:\n  ${exposed.join("\n  ")}\n`);
if (over.length) process.stderr.write(`\n${over.length} route(s) over the JS budget.\n`);
if (leaked.length || exposed.length || over.length) process.exit(1);
process.stdout.write(
  "\nAll routes within budget; no mock code or sample data in the output; no server-only secrets in browser chunks.\n",
);

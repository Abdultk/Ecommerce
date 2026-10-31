// Fails the admin build if mock-mode code reached the production output: the MSW worker
// script, the mock API handlers or the mock-only accounts. Runs after `next build`.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = [".next/static", ".next/server"];
const MARKERS = [
  { text: "INTEGRITY_CHECKSUM", what: "the MSW service worker script" },
  { text: "mock-password-local-only", what: "mock API accounts (test/mocks)" },
  { text: "mock-invite-token-local-only", what: "mock API accounts (test/mocks)" },
];

async function* files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // a root that does not exist has nothing to leak
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(js|mjs|cjs|json|html|rsc)$/.test(entry.name)) yield full;
  }
}

const problems = [];
for (const root of ROOTS) {
  for await (const file of files(root)) {
    const source = await readFile(file, "utf8");
    for (const { text, what } of MARKERS) {
      if (source.includes(text)) problems.push(`${file}: contains ${what}`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Mock-mode code found in the production build:\n  ${problems.join("\n  ")}\n`,
  );
  process.exit(1);
}
process.stdout.write("Build output check passed: no mock worker, handlers or mock accounts.\n");

#!/usr/bin/env node
// Runs load/storefront.js with the grafana/k6 image against the E2E API on the host.
// Extra args are passed to `k6 run` (e.g. -e RATE=20 -e DURATION=30s).
import path from "node:path";
import { E2E_DIR, settings, urls } from "./env.mjs";
import {
  DOCKER_HOST,
  HOST_GATEWAY_ARGS,
  assertReachable,
  dockerRun,
  ensureDir,
} from "./docker-tools.mjs";

const K6_IMAGE = process.env.E2E_K6_IMAGE ?? "grafana/k6:1.0.0";
const loadDir = path.join(E2E_DIR, "load");
ensureDir(path.join(loadDir, "results"));
await assertReachable(`${urls.api}/health`);

const code = dockerRun(
  [
    ...HOST_GATEWAY_ARGS,
    "-v",
    `${loadDir}:/scripts`,
    K6_IMAGE,
    "run",
    "-e",
    `BASE_URL=http://${DOCKER_HOST}:${settings.apiPort}/api/v1`,
    "--summary-export",
    "/scripts/results/summary.json",
    ...process.argv.slice(2),
    "/scripts/storefront.js",
  ],
  // 99 = thresholds crossed: the summary is still written, and the exit code is kept.
  { allowedExitCodes: [0, 99] },
);
process.exit(code ?? 1);

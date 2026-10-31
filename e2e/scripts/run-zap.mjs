#!/usr/bin/env node
// OWASP ZAP baseline (passive) scans of the E2E storefront, admin and API, using
// zap/rules.tsv. Exit code: 0 clean, 1 at least one FAIL rule, 2 warnings only.
import path from "node:path";
import { E2E_DIR, settings, urls } from "./env.mjs";
import {
  DOCKER_HOST,
  HOST_GATEWAY_ARGS,
  assertReachable,
  dockerRun,
  ensureDir,
} from "./docker-tools.mjs";

const ZAP_IMAGE = process.env.E2E_ZAP_IMAGE ?? "ghcr.io/zaproxy/zaproxy:stable";
const zapDir = path.join(E2E_DIR, "zap");
ensureDir(path.join(zapDir, "reports"));

const targets = [
  { name: "web", url: `http://${DOCKER_HOST}:${settings.webPort}/`, check: urls.web },
  {
    name: "admin",
    url: `http://${DOCKER_HOST}:${settings.adminPort}/login`,
    check: `${urls.admin}/login`,
  },
  {
    name: "api",
    url: `http://${DOCKER_HOST}:${settings.apiPort}/api/v1/products`,
    check: `${urls.api}/health`,
  },
];
const only = process.argv[2];
let worst = 0;
for (const target of targets.filter((t) => !only || t.name === only)) {
  await assertReachable(target.check);
  const code = dockerRun(
    [
      ...HOST_GATEWAY_ARGS,
      "-v",
      `${zapDir}:/zap/wrk:rw`,
      "-t",
      ZAP_IMAGE,
      "zap-baseline.py",
      "-t",
      target.url,
      "-c",
      "rules.tsv",
      "-m",
      "2", // spider minutes
      "-r",
      `reports/${target.name}.html`,
      "-J",
      `reports/${target.name}.json`,
      "-w",
      `reports/${target.name}.md`,
    ],
    { allowedExitCodes: [0, 1, 2] },
  );
  console.log(`[zap] ${target.name}: exit ${code}`);
  worst = code === 1 || worst === 1 ? 1 : Math.max(worst, code ?? 0);
}
process.exit(worst);

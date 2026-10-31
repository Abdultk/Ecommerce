// Helpers for running grafana/k6 and OWASP ZAP in docker against the E2E stack on the host.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

/** How containers reach the host's E2E ports (Docker Desktop; Linux needs host-gateway). */
export const DOCKER_HOST = process.env.E2E_DOCKER_HOST ?? "host.docker.internal";
export const HOST_GATEWAY_ARGS = ["--add-host", `${DOCKER_HOST}:host-gateway`];

export async function assertReachable(url) {
  try {
    const res = await fetch(url);
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `${url} is not up (${err instanceof Error ? err.message : err}). ` +
        "Start the E2E stack first: node scripts/servers.mjs all",
    );
  }
}

export function dockerRun(args, { allowedExitCodes = [0] } = {}) {
  console.log(`docker run ${args.join(" ")}`);
  const result = spawnSync("docker", ["run", "--rm", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (!allowedExitCodes.includes(result.status ?? -1)) {
    throw new Error(`docker exited with ${result.status}`);
  }
  return result.status;
}

export const ensureDir = (dir) => mkdirSync(dir, { recursive: true });

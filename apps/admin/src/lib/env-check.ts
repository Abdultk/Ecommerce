// Build/startup checks for the admin's public configuration. NEXT_PUBLIC_* values are
// inlined at build time, so next.config.ts runs assertProductionEnv() before a production
// build (and again when `next start` loads the config) and refuses to continue on problems.

export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Where presigned uploads go outside production when nothing is configured. */
export const DEV_UPLOAD_ORIGIN = "https://*.r2.cloudflarestorage.com";
const FIXTURE_CDN_HOST = "cdn.example.test";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function apiUrlProblem(value: string | undefined): string | null {
  const url = parseUrl(value);
  if (!url) return "NEXT_PUBLIC_API_URL must be set to the API base URL.";
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  return url.protocol === "https:" || local ? null : "NEXT_PUBLIC_API_URL must use https.";
}

function cdnUrlProblem(value: string | undefined): string | null {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:") {
    return "NEXT_PUBLIC_CDN_URL must be set to the https product image CDN.";
  }
  return url.hostname === FIXTURE_CDN_HOST
    ? `NEXT_PUBLIC_CDN_URL must not be the fixture CDN (${FIXTURE_CDN_HOST}).`
    : null;
}

/** True for a bare https origin such as https://bucket.account.r2.cloudflarestorage.com. */
function isExactHttpsOrigin(value: string): boolean {
  if (value.includes("*")) return false;
  const url = parseUrl(value);
  return !!url && url.protocol === "https:" && url.origin === value.replace(/\/$/, "");
}

function uploadOriginProblem(value: string | undefined): string | null {
  return value && isExactHttpsOrigin(value)
    ? null
    : "NEXT_PUBLIC_UPLOAD_ORIGIN must be the exact https origin of the R2 bucket " +
        "(for example https://<bucket>.<account>.r2.cloudflarestorage.com), with no wildcard or path.";
}

/** Every reason this configuration is unsafe for a production build; empty when it is fine. */
export function productionEnvProblems(env: EnvLike): string[] {
  return [
    apiUrlProblem(env.NEXT_PUBLIC_API_URL),
    cdnUrlProblem(env.NEXT_PUBLIC_CDN_URL),
    uploadOriginProblem(env.NEXT_PUBLIC_UPLOAD_ORIGIN),
  ].filter((p): p is string => p !== null);
}

export function assertProductionEnv(env: EnvLike): void {
  const problems = productionEnvProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Admin production configuration is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
  );
}

/**
 * The connect-src origin for presigned uploads. Production uses only the configured exact
 * origin (assertProductionEnv guarantees it exists); dev and tests fall back to the wildcard.
 */
export function uploadOriginFor(env: EnvLike, production: boolean): string {
  const configured = env.NEXT_PUBLIC_UPLOAD_ORIGIN?.replace(/\/$/, "");
  if (configured) return configured;
  return production ? "" : DEV_UPLOAD_ORIGIN;
}

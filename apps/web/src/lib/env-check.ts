// Build/startup checks for the storefront's public configuration. NEXT_PUBLIC_* values are
// inlined at build time, so next.config.ts runs assertProductionEnv() for `next build`
// (and again when `next start` loads the config) and refuses to continue on problems.
// This file must not use the "@/" alias: next.config.ts imports it directly.

import { clientIpSettingProblems } from "./client-ip";

export type EnvLike = Readonly<Record<string, string | undefined>>;

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

/** https, or plain http on a loopback host for local production smoke runs. */
function httpsOrLocalProblem(name: string, value: string | undefined): string | null {
  const url = parseUrl(value);
  if (!url) return `${name} must be set to an absolute URL.`;
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  return url.protocol === "https:" || local ? null : `${name} must use https.`;
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

const MIN_INTERNAL_TOKEN_LENGTH = 32;

/** Shared secret for server-to-API calls (D-04). The message never echoes the value. */
function internalTokenProblem(value: string | undefined): string | null {
  if (!value) return "INTERNAL_API_TOKEN must be set (server-only; the same value as the API's).";
  return value.length < MIN_INTERNAL_TOKEN_LENGTH
    ? `INTERNAL_API_TOKEN must be at least ${MIN_INTERNAL_TOKEN_LENGTH} characters.`
    : null;
}

/** The E2E-only switch for plain-http payment pages must never ride along to a real site. */
function localPaymentPageProblem(env: EnvLike): string | null {
  const on = env.NEXT_PUBLIC_E2E_LOCAL_PAYMENT_PAGE === "true";
  const https = (env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");
  return on && https
    ? "NEXT_PUBLIC_E2E_LOCAL_PAYMENT_PAGE must not be set on an https site."
    : null;
}

/** Every reason this configuration is unsafe for a production build; empty when it is fine. */
export function productionEnvProblems(env: EnvLike): string[] {
  return [
    httpsOrLocalProblem("NEXT_PUBLIC_API_URL", env.NEXT_PUBLIC_API_URL),
    httpsOrLocalProblem("NEXT_PUBLIC_SITE_URL", env.NEXT_PUBLIC_SITE_URL),
    cdnUrlProblem(env.NEXT_PUBLIC_CDN_URL),
    internalTokenProblem(env.INTERNAL_API_TOKEN),
    localPaymentPageProblem(env),
    ...clientIpSettingProblems(env),
  ].filter((p): p is string => p !== null);
}

export function assertProductionEnv(env: EnvLike): void {
  const problems = productionEnvProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Storefront production configuration is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
  );
}

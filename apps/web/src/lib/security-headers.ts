// Security headers for the storefront. The CSP needs a per-request nonce (Next's App
// Router emits inline bootstrap scripts), so src/middleware.ts sets it; the static
// headers are applied to every route by next.config.ts. This file must not use the
// "@/" alias: next.config.ts imports it directly.

export type Header = { key: string; value: string };

export type CspOptions = {
  nonce: string;
  apiUrl: string;
  /** Product image CDN origin ("" when unset). */
  cdnUrl: string;
  /** `next dev`: allows eval (React refresh) and websockets (HMR). */
  isDev: boolean;
  /** `next build` / `next start`: drops the fixture CDN and localhost image hosts. */
  isProduction: boolean;
};

export type RemotePattern = { protocol: "http" | "https"; hostname: string };

/** The fixture CDN used by the shared sample catalog and the mock API (dev/test only). */
export const FIXTURE_CDN_ORIGIN = "https://cdn.example.test";

// Stripe.js and the Payment Element (iframes, 3-D Secure) per Stripe's CSP guidance;
// Elements frames and scripts may be served from js.stripe.com subdomains.
const STRIPE_SCRIPT = "https://js.stripe.com https://*.js.stripe.com";
const STRIPE_FRAMES = "https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com";
const STRIPE_CONNECT = "https://api.stripe.com";
const STRIPE_IMAGES = "https://*.stripe.com";

/** Two years, subdomains, preload-list eligible. Only sent by production builds (HTTPS). */
export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

const originOf = (url: string): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** 128 random bits, base64 — a fresh value for every request. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function imageSources(cdnUrl: string, isProduction: boolean): string {
  const cdn = originOf(cdnUrl);
  const devHosts = isProduction ? [] : [FIXTURE_CDN_ORIGIN, "http://localhost:*"];
  const hosts = [...new Set([...(cdn ? [cdn] : []), ...devHosts, STRIPE_IMAGES])];
  return hosts.join(" ");
}

export function buildCsp({ nonce, apiUrl, cdnUrl, isDev, isProduction }: CspOptions): string {
  const apiOrigin = originOf(apiUrl) ?? "";
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's nonce'd loader (and loadStripe) add scripts; 'self' and
    // the Stripe host are CSP2 fallbacks that CSP3 browsers ignore.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${STRIPE_SCRIPT}${isDev ? " 'unsafe-eval'" : ""}`,
    // React/Next and Stripe set style attributes; no user content is rendered as style.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${imageSources(cdnUrl, isProduction)}`,
    "font-src 'self'",
    ["connect-src 'self'", apiOrigin, STRIPE_CONNECT, isDev ? "ws:" : ""].filter(Boolean).join(" "),
    `frame-src ${STRIPE_FRAMES}`,
    // Nothing registers a service worker.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  const upgrade = isProduction && !isDev && apiOrigin.startsWith("https://");
  return [...directives, ...(upgrade ? ["upgrade-insecure-requests"] : [])].join("; ");
}

export function staticSecurityHeaders({ production }: { production: boolean }): Header[] {
  const hsts: Header[] = production
    ? [{ key: "Strict-Transport-Security", value: HSTS_VALUE }]
    : [];
  return [
    ...hsts,
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

/** next/image hosts: the configured CDN; plus the fixture CDN and localhost outside production. */
export function imageRemotePatterns({
  cdnUrl,
  isProduction,
}: {
  cdnUrl: string;
  isProduction: boolean;
}): RemotePattern[] {
  const cdn = originOf(cdnUrl);
  const configured: RemotePattern[] = cdn
    ? [{ protocol: cdn.startsWith("http:") ? "http" : "https", hostname: new URL(cdn).hostname }]
    : [];
  const dev: RemotePattern[] = isProduction
    ? []
    : [
        { protocol: "https", hostname: new URL(FIXTURE_CDN_ORIGIN).hostname },
        { protocol: "http", hostname: "localhost" },
      ];
  return [...configured, ...dev];
}

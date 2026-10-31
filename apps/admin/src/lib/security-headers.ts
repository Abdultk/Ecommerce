// Security headers for the admin origin. The CSP needs a per-request nonce
// (Next's App Router emits inline bootstrap scripts), so it is set in
// src/middleware.ts; the static headers are applied to every route by next.config.ts.

export type Header = { key: string; value: string };

export type CspOptions = {
  apiUrl: string;
  nonce: string;
  isDev: boolean;
  /** Product image CDN (the API builds image URLs from R2 keys on this host). */
  cdnUrl: string;
  /** Where presigned uploads are PUT; a host wildcard only outside production; "" for none. */
  uploadOrigin: string;
};

export function buildCsp({ apiUrl, nonce, isDev, cdnUrl, uploadOrigin }: CspOptions): string {
  const apiOrigin = new URL(apiUrl).origin;
  const imageOrigin = new URL(cdnUrl).origin;
  const uploads = uploadOrigin ? ` ${uploadOrigin}` : "";
  const isHttps = apiOrigin.startsWith("https://");
  const directives: string[] = [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's nonce'd loader pull in its chunks; 'self' is a CSP2 fallback.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React/Next set a few style attributes; no user content is rendered as style.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${imageOrigin}`,
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}${uploads}${isDev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (isHttps && !isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Two years, subdomains, preload-list eligible. Only sent by production builds (HTTPS). */
export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

export function staticSecurityHeaders({
  production = false,
}: { production?: boolean } = {}): Header[] {
  const hsts: Header[] = production
    ? [{ key: "Strict-Transport-Security", value: HSTS_VALUE }]
    : [];
  return [
    ...hsts,
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

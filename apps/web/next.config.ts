import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { assertProductionEnv } from "./src/lib/env-check";
import { imageRemotePatterns, staticSecurityHeaders } from "./src/lib/security-headers";

// `next build` and `next start` run with NODE_ENV=production. Refuse to build or start with
// the fixture CDN or a missing/insecure API or site URL.
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) assertProductionEnv(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: imageRemotePatterns({
      cdnUrl: process.env.NEXT_PUBLIC_CDN_URL ?? "",
      isProduction,
    }),
  },
  // Lint runs as its own task (`pnpm --filter @hp/web lint`) with the flat config.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    // The nonce-based Content-Security-Policy is added per request in src/middleware.ts.
    return [{ source: "/:path*", headers: staticSecurityHeaders({ production: isProduction }) }];
  },
};

// Cookie-based language choice: no locale prefix in URLs, so no routes move.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

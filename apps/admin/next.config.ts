import type { NextConfig } from "next";
import { assertProductionEnv } from "./src/lib/env-check";
import { staticSecurityHeaders } from "./src/lib/security-headers";

// `next build` and `next start` run with NODE_ENV=production. Refuse to build or start with
// a wildcard upload host, the fixture CDN or a missing API URL.
const isProduction = process.env.NODE_ENV === "production";
if (isProduction) assertProductionEnv(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs as its own task (pnpm --filter @hp/admin lint).
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    // The nonce-based Content-Security-Policy is added per request in src/middleware.ts.
    return [{ source: "/:path*", headers: staticSecurityHeaders({ production: isProduction }) }];
  },
};

export default nextConfig;

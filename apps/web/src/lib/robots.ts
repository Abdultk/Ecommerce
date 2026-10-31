import type { MetadataRoute } from "next";

/** Per-user, transactional and one-time-link pages: nothing to index, and links carry tokens. */
const PRIVATE_PATHS = [
  "/account",
  "/cart",
  "/checkout",
  "/orders/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

export function buildRobots(siteUrl: string): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

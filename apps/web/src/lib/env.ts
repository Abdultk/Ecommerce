export const DEFAULT_API_URL = "http://localhost:4000/api/v1";

/** Public API base URL (no trailing slash). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/** Product image CDN (the API builds image URLs on this host). Required in production builds. */
export const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL ?? "";

/** True for `next build` / `next start`; dev and tests run with other NODE_ENV values. */
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * End-to-end builds only: lets the checkout open the fake card provider's plain-http local
 * page from a production build. assertProductionEnv refuses it on any https site.
 */
export const ALLOW_LOCAL_PAYMENT_PAGE = process.env.NEXT_PUBLIC_E2E_LOCAL_PAYMENT_PAGE === "true";

/** Stripe publishable key; when unset, the Stripe payment step shows a configuration message. */
export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

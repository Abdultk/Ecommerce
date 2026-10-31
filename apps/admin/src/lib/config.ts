import { uploadOriginFor } from "./env-check";

const DEFAULT_API_URL = "http://localhost:4000/api/v1";

/** Public API base URL. NEXT_PUBLIC_* is inlined at build time, so it must be read literally. */
export const API_URL: string = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;

/** Placeholder CDN host: the fallback outside production, refused by a production build. */
export const FIXTURE_CDN_URL = "https://cdn.example.test";

/** Public CDN that serves product images (the API builds image URLs from R2 keys). */
export const CDN_URL: string = process.env.NEXT_PUBLIC_CDN_URL || FIXTURE_CDN_URL;

/** True for `next build` / `next start`; dev and tests run with other NODE_ENV values. */
export const IS_PRODUCTION: boolean = process.env.NODE_ENV === "production";

/**
 * Origin that presigned image uploads are PUT to (the R2 bucket's S3 host). Production
 * requires the exact host (enforced by assertProductionEnv in next.config.ts); dev and
 * tests fall back to the *.r2.cloudflarestorage.com wildcard.
 */
export const UPLOAD_ORIGIN: string = uploadOriginFor(
  { NEXT_PUBLIC_UPLOAD_ORIGIN: process.env.NEXT_PUBLIC_UPLOAD_ORIGIN },
  IS_PRODUCTION,
);

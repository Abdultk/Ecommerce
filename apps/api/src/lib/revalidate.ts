/**
 * On-demand ISR revalidation helper.
 *
 * After any admin mutation that affects public-facing data, call revalidateSite()
 * with the relevant cache tag. The storefront's Route Handler at /api/revalidate
 * will call Next.js revalidateTag() so the next visitor gets fresh data without a
 * full deploy.
 *
 * The call is fire-and-forget: a failure is logged but never propagated to the
 * admin response — the write already succeeded in Postgres.
 */

import { safeErrorFields } from "./safe-error";
import { env } from "../config/env";
import { logger } from "./logger";

/** Well-known cache tags. Must match the `next: { tags }` values in apps/web. */
export type RevalidationTag =
  | "products"
  | "categories"
  | "settings"
  | `product:${string}`;

/**
 * Sends a POST to the storefront's revalidation Route Handler.
 * Failures are logged as warnings — they never throw.
 */
export async function revalidateSite(...tags: RevalidationTag[]): Promise<void> {
  const url = env.WEB_REVALIDATE_URL;
  const secret = env.REVALIDATE_SECRET;

  if (!url || !secret) {
    // Not configured (dev / test without a running Next.js instance) — skip silently.
    return;
  }

  const endpoint = `${url.replace(/\/+$/, "")}/api/revalidate`;

  await Promise.allSettled(
    tags.map(async (tag) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-revalidate-secret": secret,
          },
          body: JSON.stringify({ tag }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          logger.warn({ tag, status: res.status }, "revalidate: non-OK response");
        }
      } catch (err) {
        logger.warn({ err: safeErrorFields(err), tag }, "revalidate: request failed (non-fatal)");
      }
    }),
  );
}

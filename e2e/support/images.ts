import type { Page } from "@playwright/test";
import { FAKE_CDN_ORIGIN } from "../scripts/env.mjs";

/** A valid 1×1 PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Stands in for object storage: presigned PUTs succeed and image GETs return the PNG.
 * Only the fictional E2E CDN host is intercepted.
 */
export async function stubImageCdn(page: Page): Promise<string[]> {
  const uploads: string[] = [];
  await page.route(`${FAKE_CDN_ORIGIN}/**`, async (route) => {
    if (route.request().method() === "PUT") {
      uploads.push(route.request().url());
      return route.fulfill({ status: 200, body: "" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
  });
  return uploads;
}

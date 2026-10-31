import "server-only";
import { cache } from "react";
import type { PublicStoreConfig } from "@hp/contracts";
import { orFallback } from "./catalog";
import { serverApi } from "./server-api";
import { DEFAULT_STORE_CONFIG, getStoreConfig } from "./store-config";

/**
 * GET /store for server components: deduplicated per request by React's cache and kept in
 * Next's data cache like the other public reads (the API sends max-age=60). A failure must
 * not take every page down, so it falls back to the defaults and logs on the server.
 */
export const loadStoreConfig = cache((): Promise<PublicStoreConfig> =>
  orFallback(getStoreConfig(serverApi), DEFAULT_STORE_CONFIG, "store config"),
);

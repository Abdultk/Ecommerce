import "server-only";
import { getLocale } from "next-intl/server";
import { API_URL } from "./env";
import { catalogReadHeaders, createServerApiClient } from "./internal-api";

// INTERNAL_API_TOKEN is a server-only secret (never NEXT_PUBLIC_): it is read at request
// time, the "server-only" import makes any client import a build error, and the build
// output check fails if the header name appears in a browser chunk.
const internalToken = (): string | undefined => process.env.INTERNAL_API_TOKEN;

/**
 * Server components' client. Every current server read is a cacheable public catalog
 * read (layout, home, listings, product pages, sitemap), so it sends the token only.
 * An uncached per-shopper call would instead use internalApiHeaders(token, await
 * headers(), clientIpSourceFrom(process.env)) to add X-HP-Client-IP.
 */
export const serverApi = createServerApiClient(API_URL, async () => ({
  ...catalogReadHeaders(internalToken()),
  // The API returns catalog text in this language (the locale cookie decides it).
  "Accept-Language": await getLocale(),
}));

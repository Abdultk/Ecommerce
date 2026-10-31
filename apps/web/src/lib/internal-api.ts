import "server-only";
import { createApiClient, type ApiClient } from "@hp/api-client";
import { clientIpFrom, type ClientIpSource } from "./client-ip";

// Server-to-API calls (D-04). SSR reaches the API from the host's address, so per-IP
// limits would throttle every shopper together. Requests carrying the shared
// INTERNAL_API_TOKEN (compared in constant time by the API) are recognised as the
// storefront: token-only requests use the API's internal bucket; a request may also name
// the shopper's address in X-HP-Client-IP to be limited per shopper.

export const INTERNAL_TOKEN_HEADER = "X-Internal-Token";
export const CLIENT_IP_HEADER = "X-HP-Client-IP";

/** A hung API must not hold an SSR render (and its worker) open indefinitely. */
export const SERVER_API_TIMEOUT_MS = 10_000;

export { clientIpFrom, clientIpSourceFrom, type ClientIpSource } from "./client-ip";

/** The read-only slice of the API client that server components use. */
export type CatalogApi = Pick<ApiClient, "get">;
export type HeaderSource = () => Record<string, string> | Promise<Record<string, string>>;

/**
 * Headers for cacheable public reads (catalog, categories, products): the token only.
 * Next's fetch cache keys include headers, so a per-shopper IP would split the cache per
 * visitor; the API gives token-only requests a separate high-limit internal bucket.
 */
export function catalogReadHeaders(token: string | undefined): Record<string, string> {
  return token ? { [INTERNAL_TOKEN_HEADER]: token } : {};
}

/**
 * Headers for uncached, per-shopper server calls: the token plus the shopper's IP from
 * the configured header (see client-ip.ts). Nothing without a token (dev).
 */
export function internalApiHeaders(
  token: string | undefined,
  requestHeaders: Headers | null,
  source: ClientIpSource,
): Record<string, string> {
  if (!token) return {};
  const ip = requestHeaders ? clientIpFrom(requestHeaders, source) : null;
  return { ...catalogReadHeaders(token), ...(ip ? { [CLIENT_IP_HEADER]: ip } : {}) };
}

/** GET-only API client for server components: shared envelope handling, extra headers, timeout. */
export function createServerApiClient(baseUrl: string, getHeaders: HeaderSource): CatalogApi {
  const client = createApiClient(baseUrl, undefined, {
    headers: getHeaders,
    timeoutMs: SERVER_API_TIMEOUT_MS,
  });
  return { get: client.get };
}

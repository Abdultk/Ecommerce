import type { z } from "zod";
import { createApiClient, createEndpoints, type ApiClient } from "@hp/api-client";
import { authStore, refreshSession, whenSessionReady } from "./auth-store";
import { API_URL } from "./env";

/** The session is known: signed in or not. */
const gate = (): Promise<void> => whenSessionReady();

/**
 * Delays every call until the silent session refresh has settled, so no request goes out without the customer's token.
 */
export function withSessionGate(client: ApiClient): ApiClient {
  return {
    get: <T>(path: string, schema?: z.ZodType<T>) => gate().then(() => client.get<T>(path, schema)),
    post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>, headers?: HeadersInit) =>
      gate().then(() => client.post<T>(path, body, schema, headers)),
    put: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      gate().then(() => client.put<T>(path, body, schema)),
    patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      gate().then(() => client.patch<T>(path, body, schema)),
    delete: <T>(path: string, schema?: z.ZodType<T>) =>
      gate().then(() => client.delete<T>(path, schema)),
  };
}

/** Browser client: attaches the in-memory access token and refreshes once on a 401. */
export const browserApi = withSessionGate(
  createApiClient(
    API_URL,
    { get: authStore.getToken, refresh: refreshSession },
    // Catalog text (product and variant names in the cart, search) comes back in the shopper's language.
    {
      headers: () => ({
        "Accept-Language":
          typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar" : "en",
      }),
    },
  ),
);

/** Typed Phase 3b calls (store config, checkout status) over the same gated client. */
export const endpoints = createEndpoints(browserApi);

// Server components use serverApi from ./server-api (server-only: it carries the internal token).

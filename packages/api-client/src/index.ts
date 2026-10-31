import type { z } from "zod";
import { ApiError, PageMeta, type ErrorCode } from "@hp/contracts";

/** Every non-success outcome — API error, bad payload, network failure — surfaces as this. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    error: { code: ErrorCode; message: string; details?: Record<string, unknown> },
  ) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

/** Supplies the in-memory access token and refreshes it (via the httpOnly refresh cookie). */
export type TokenSource = {
  get(): string | null;
  refresh(): Promise<string | null>;
};

export type ApiResult<T> = { data: T; meta?: PageMeta };

export type ApiClientOptions = {
  /** Headers added to every request (e.g. a server-only service token); per-call headers win. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Abort a request after this many milliseconds; reported like a network failure. */
  timeoutMs?: number;
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
const BAD_RESPONSE_MESSAGE = "The server sent an unexpected response. Please try again.";

// A 401 from these means "wrong credentials / session over", not "access token expired".
const NO_REFRESH_PATHS = ["/auth/", "/admin/auth/"];

export function createApiClient(
  baseUrl: string,
  tokens?: TokenSource,
  options: ApiClientOptions = {},
) {
  let refreshInFlight: Promise<string | null> | null = null;

  // Concurrent 401s share one refresh, so a refresh token is never presented twice
  // (the API treats reuse of a rotated refresh token as theft).
  const refreshOnce = (): Promise<string | null> => {
    if (!tokens) return Promise.resolve(null);
    refreshInFlight ??= tokens.refresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  async function send(
    method: Method,
    path: string,
    body: unknown,
    headers: HeadersInit | undefined,
  ): Promise<Response> {
    const token = tokens?.get();
    const defaults = options.headers ? await options.headers() : {};
    try {
      return await fetch(`${baseUrl}${path}`, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...defaults,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
      });
    } catch {
      throw new ApiClientError(0, { code: "INTERNAL", message: NETWORK_ERROR_MESSAGE });
    }
  }

  async function readEnvelope(
    res: Response,
  ): Promise<{ success?: unknown; data?: unknown; error?: unknown; meta?: unknown }> {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      throw new ApiClientError(res.status, { code: "INTERNAL", message: BAD_RESPONSE_MESSAGE });
    }
  }

  async function request<T>(
    method: Method,
    path: string,
    schema: z.ZodType<T> | undefined,
    body?: unknown,
    headers?: HeadersInit,
  ): Promise<ApiResult<T>> {
    let res = await send(method, path, body, headers);

    const mayRefresh =
      res.status === 401 && tokens && !NO_REFRESH_PATHS.some((p) => path.startsWith(p));
    if (mayRefresh && (await refreshOnce())) {
      res = await send(method, path, body, headers);
    }

    const envelope = await readEnvelope(res);

    if (envelope.success !== true) {
      const error = ApiError.safeParse(envelope.error);
      throw new ApiClientError(
        res.status,
        error.success ? error.data : { code: "INTERNAL", message: BAD_RESPONSE_MESSAGE },
      );
    }

    // Never trust the network: validate the payload when the caller gives a schema.
    const data = schema
      ? schema.safeParse(envelope.data)
      : { success: true as const, data: envelope.data as T };
    const meta = envelope.meta === undefined ? undefined : PageMeta.safeParse(envelope.meta);
    if (!data.success || (meta && !meta.success)) {
      throw new ApiClientError(res.status, { code: "INTERNAL", message: BAD_RESPONSE_MESSAGE });
    }
    return { data: data.data, meta: meta?.data };
  }

  return {
    get: <T>(path: string, schema?: z.ZodType<T>) => request<T>("GET", path, schema),
    post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>, headers?: HeadersInit) =>
      request<T>("POST", path, schema, body ?? {}, headers),
    put: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>("PUT", path, schema, body),
    patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>("PATCH", path, schema, body),
    delete: <T>(path: string, schema?: z.ZodType<T>) => request<T>("DELETE", path, schema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export { createEndpoints, type Endpoints } from "./endpoints";

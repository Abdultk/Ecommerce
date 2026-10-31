import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "OUT_OF_STOCK",
  "COUPON_INVALID",
  "PAYMENT_FAILED",
  "RATE_LIMITED",
  "INTERNAL",
  // Phase 3b
  "PAYMENT_METHOD_UNAVAILABLE",
  "CURRENCY_LOCKED",
  "AMOUNT_MISMATCH",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The HTTP status the API sends with each error code. Clients may rely on it. */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  PAYMENT_FAILED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OUT_OF_STOCK: 409,
  COUPON_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PAYMENT_METHOD_UNAVAILABLE: 422,
  CURRENCY_LOCKED: 409,
  AMOUNT_MISMATCH: 422,
});

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const PageMeta = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PageMeta = z.infer<typeof PageMeta>;

/**
 * Every API response body has this shape. Success always carries `data` of the
 * given schema (use `z.null()` for endpoints with no body); failure always
 * carries an `error` and never `data` or `meta`.
 */
export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("success", [
    z.object({
      success: z.literal(true),
      data,
      error: z.null(),
      meta: PageMeta.optional(),
    }),
    z.object({
      success: z.literal(false),
      data: z.null(),
      error: ApiError,
    }),
  ]);

export type ApiSuccess<T> = { success: true; data: T; error: null; meta?: PageMeta };
export type ApiFailure = { success: false; data: null; error: ApiError };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data, error: null });

export const fail = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiFailure => ({
  success: false,
  data: null,
  error: details === undefined ? { code, message } : { code, message, details },
});

export const paged = <T>(
  data: T,
  meta: { page: number; pageSize: number; total: number },
): ApiSuccess<T> & { meta: PageMeta } => ({
  success: true,
  data,
  error: null,
  meta: { ...meta, totalPages: Math.ceil(meta.total / meta.pageSize) },
});

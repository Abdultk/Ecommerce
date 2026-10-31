import { ERROR_HTTP_STATUS, type ErrorCode } from "@hp/contracts";

/** An expected failure with a user-safe message. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

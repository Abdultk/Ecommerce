import * as Sentry from "@sentry/node";
import type { ErrorEvent, NodeOptions } from "@sentry/node";
import type { Express } from "express";

/** Request headers that are safe to send; everything else (auth, cookies, signatures) is dropped. */
const SAFE_HEADERS = new Set(["user-agent", "content-type", "accept"]);
const REDACTED = "[redacted]";

type Config = { service: "api" | "worker"; dsn?: string; release?: string; nodeEnv: string };

/**
 * Removes anything that could be personal data or a secret: request bodies, cookies,
 * query strings (tokens), non-allowlisted headers, the user, breadcrumbs and exception
 * messages (which can echo emails or SQL values). Keeps types and stack frames.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request && {
    method: event.request.method,
    url: event.request.url?.split("?")[0],
    headers: Object.fromEntries(
      Object.entries(event.request.headers ?? {}).filter(([k]) =>
        SAFE_HEADERS.has(k.toLowerCase()),
      ),
    ),
  };
  const values = event.exception?.values?.map((v) => ({ ...v, value: REDACTED }));
  const { user: _user, message: _message, ...rest } = event;
  return {
    ...rest,
    ...(request && { request }),
    ...(values && { exception: { ...event.exception, values } }),
    breadcrumbs: [],
  };
}

/** Sentry options, or null (disabled) without a DSN. */
export function sentryOptions(config: Config): NodeOptions | null {
  if (!config.dsn) return null;
  return {
    dsn: config.dsn,
    release: config.release,
    environment: config.nodeEnv,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { service: config.service } },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: () => null,
  };
}

let enabled = false;

/** Starts Sentry when SENTRY_DSN is set; otherwise every helper here is a no-op. */
export function initSentry(config: Config): boolean {
  const options = sentryOptions(config);
  if (!options) return false;
  Sentry.init(options);
  enabled = true;
  return true;
}

/** Registers Sentry's Express error handler (5xx only). Call before the app's own handler. */
export function sentryErrorHandler(app: Express): void {
  if (enabled) Sentry.setupExpressErrorHandler(app);
}

/** Reports a payment-path failure that was handled (so it never reaches the error handler). */
export function capturePaymentError(err: unknown, context: Record<string, string> = {}): void {
  if (enabled) Sentry.captureException(err, { tags: { area: "payment", ...context } });
}

/** Reports a background job that failed (after BullMQ gave up on that attempt). */
export function captureJobFailure(err: unknown, queue: string): void {
  if (enabled) Sentry.captureException(err, { tags: { area: "worker", queue } });
}

export type CronSchedule = { name: string; crontab: string };

/** Wraps a scheduled job in a Sentry cron monitor check-in (no-op when disabled). */
export function withCronMonitor<T>(schedule: CronSchedule, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  return Sentry.withMonitor(schedule.name, run, {
    schedule: { type: "crontab", value: schedule.crontab },
    checkinMargin: 2,
    maxRuntime: 10,
  });
}

import { describe, expect, it, vi } from "vitest";
import express from "express";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
  captureException: vi.fn(),
  withMonitor: vi.fn((_name: string, run: () => unknown) => run()),
}));
vi.mock("@sentry/node", () => sentry);

const DSN = "https://key@o1.ingest.sentry.io/1";

describe("Sentry runtime helpers", () => {
  it("are no-ops until initialised, and initSentry refuses without a DSN", async () => {
    const mod = await import("./sentry");
    expect(mod.initSentry({ service: "api", nodeEnv: "test" })).toBe(false);
    mod.sentryErrorHandler(express());
    mod.capturePaymentError(new Error("x"));
    expect(await mod.withCronMonitor({ name: "job", crontab: "* * * * *" }, async () => 7)).toBe(7);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.setupExpressErrorHandler).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.withMonitor).not.toHaveBeenCalled();
  });

  it("reports through Sentry once initialised", async () => {
    const mod = await import("./sentry");
    expect(
      mod.initSentry({ service: "worker", dsn: DSN, release: "abc", nodeEnv: "production" }),
    ).toBe(true);
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, sendDefaultPii: false }),
    );

    const app = express();
    mod.sentryErrorHandler(app);
    expect(sentry.setupExpressErrorHandler).toHaveBeenCalledWith(app);

    const err = new Error("declined");
    mod.capturePaymentError(err, { step: "cancel_refund" });
    expect(sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { area: "payment", step: "cancel_refund" },
    });

    const jobErr = new Error("smtp down");
    mod.captureJobFailure(jobErr, "email");
    expect(sentry.captureException).toHaveBeenCalledWith(jobErr, {
      tags: { area: "worker", queue: "email" },
    });

    const result = await mod.withCronMonitor(
      { name: "purge-expired-carts", crontab: "0 * * * *" },
      async () => "done",
    );
    expect(result).toBe("done");
    expect(sentry.withMonitor).toHaveBeenCalledWith(
      "purge-expired-carts",
      expect.any(Function),
      expect.objectContaining({ schedule: { type: "crontab", value: "0 * * * *" } }),
    );
  });

  it("scrubs events through beforeSend and drops breadcrumbs", async () => {
    const { sentryOptions } = await import("./sentry");
    const options = sentryOptions({ service: "api", dsn: DSN, nodeEnv: "production" })!;
    const event = options.beforeSend!(
      { type: undefined, user: { email: "a@example.test" } },
      {},
    ) as { user?: unknown };
    expect(event.user).toBeUndefined();
    expect(options.beforeBreadcrumb!({ message: "x" }, {})).toBeNull();
  });
});

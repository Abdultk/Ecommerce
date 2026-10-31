import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import { scrubEvent, sentryOptions } from "./sentry";

describe("sentryOptions", () => {
  it("is off without a DSN", () => {
    expect(sentryOptions({ service: "api", nodeEnv: "production" })).toBeNull();
  });

  it("takes the release from RENDER_GIT_COMMIT and never sends default PII", () => {
    const options = sentryOptions({
      service: "worker",
      dsn: "https://key@o1.ingest.sentry.io/1",
      release: "abc123",
      nodeEnv: "production",
    });
    expect(options).toMatchObject({
      dsn: "https://key@o1.ingest.sentry.io/1",
      release: "abc123",
      environment: "production",
      sendDefaultPii: false,
      initialScope: { tags: { service: "worker" } },
    });
  });
});

describe("scrubEvent", () => {
  it("drops request bodies, cookies, auth headers, query strings, users and messages", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "failed for ada@example.test",
      user: { email: "ada@example.test", ip_address: "203.0.113.1" },
      request: {
        url: "https://api.test/api/v1/orders/lookup?token=secret",
        query_string: "token=secret",
        data: { token: "secret" },
        cookies: { hp_refresh: "x" },
        headers: {
          authorization: "Bearer x",
          cookie: "a=b",
          "user-agent": "UA",
          "stripe-signature": "s",
        },
      },
      exception: { values: [{ type: "Error", value: "duplicate key ada@example.test" }] },
      breadcrumbs: [{ message: "select * where email = 'ada@example.test'" }],
    };
    const clean = scrubEvent(event);
    const text = JSON.stringify(clean);
    expect(text).not.toContain("ada@example.test");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("Bearer");
    expect(clean.request?.url).toBe("https://api.test/api/v1/orders/lookup");
    expect(clean.request?.headers).toEqual({ "user-agent": "UA" });
    expect(clean.exception?.values?.[0]).toMatchObject({ type: "Error", value: "[redacted]" });
    expect(clean.user).toBeUndefined();
    expect(clean.breadcrumbs).toEqual([]);
    expect(event.request?.data).toEqual({ token: "secret" }); // input untouched
  });
});

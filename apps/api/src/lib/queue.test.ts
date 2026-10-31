import { describe, expect, it } from "vitest";
import { EMAIL_JOB_OPTIONS, FAILED_EMAIL_RETENTION_SECONDS } from "./queue";

describe("email job options", () => {
  it("drops completed jobs and keeps failed ones (which may hold reset links) for a day at most", () => {
    expect(FAILED_EMAIL_RETENTION_SECONDS).toBe(24 * 3600);
    expect(EMAIL_JOB_OPTIONS.removeOnComplete).toBe(true);
    expect(EMAIL_JOB_OPTIONS.removeOnFail).toEqual({
      age: FAILED_EMAIL_RETENTION_SECONDS,
      count: expect.any(Number),
    });
    expect(EMAIL_JOB_OPTIONS.attempts).toBeGreaterThan(1);
  });
});

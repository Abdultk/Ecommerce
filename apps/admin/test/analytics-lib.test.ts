import { describe, expect, it } from "vitest";
import { ApiClientError } from "@hp/api-client";
import type { ReportJob } from "@hp/contracts";
import { pollInterval } from "@/components/reports/use-reports";
import { niceCeiling, percentChange, shareOf } from "@/lib/analytics-math";
import { rangeQuery, resolveRange } from "@/lib/analytics-range";
import { isTerminalJob, nextPollDelay } from "@/lib/report-polling";

const NOW = new Date("2026-10-11T15:30:00.000Z");

describe("resolveRange", () => {
  it.each([
    ["7d", "2026-10-05", 7],
    ["30d", "2026-09-12", 30],
    ["90d", "2026-07-14", 90],
    ["month", "2026-10-01", 11],
  ] as const)("resolves the %s preset to whole UTC days ending today", (preset, from, days) => {
    const result = resolveRange({ preset }, "day", NOW);
    expect(result).toEqual({
      ok: true,
      range: {
        from: `${from}T00:00:00.000Z`,
        to: "2026-10-11T23:59:59.999Z",
        interval: "day",
      },
      days,
    });
  });

  it("uses custom dates and the chosen interval", () => {
    const result = resolveRange(
      { preset: "custom", from: "2026-01-01", to: "2026-03-31" },
      "week",
      NOW,
    );
    expect(result).toMatchObject({
      ok: true,
      range: { from: "2026-01-01T00:00:00.000Z", to: "2026-03-31T23:59:59.999Z", interval: "week" },
      days: 90,
    });
  });

  it("explains an incomplete, reversed, malformed or too-long custom range", () => {
    const err = (from?: string, to?: string) =>
      resolveRange({ preset: "custom", from, to }, "day", NOW);
    expect(err(undefined, "2026-01-01")).toEqual({
      ok: false,
      error: "Choose a start and an end date.",
    });
    expect(err("2026-02-01", "2026-01-01")).toEqual({
      ok: false,
      error: "End date is before the start date.",
    });
    expect(err("2026-02-30", "2026-03-01")).toMatchObject({ ok: false });
    expect(err("2024-01-01", "2026-01-01")).toEqual({
      ok: false,
      error: "Choose a range of 366 days or less.",
    });
  });

  it("builds the API query string", () => {
    const result = resolveRange({ preset: "7d" }, "month", NOW);
    if (!result.ok) throw new Error("expected a range");
    expect(rangeQuery(result.range)).toBe(
      "from=2026-10-05T00%3A00%3A00.000Z&to=2026-10-11T23%3A59%3A59.999Z&interval=month",
    );
  });
});

describe("analytics math", () => {
  it("computes the change against the previous period", () => {
    expect(percentChange(120, 100)).toBeCloseTo(0.2);
    expect(percentChange(50, 100)).toBeCloseTo(-0.5);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });

  it("rounds an axis maximum up to a readable number", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(87)).toBe(100);
    expect(niceCeiling(130)).toBe(200);
    expect(niceCeiling(420_000)).toBe(500_000);
    expect(niceCeiling(2_400)).toBe(2_500);
  });

  it("returns a share, or 0 when the whole is empty", () => {
    expect(shareOf(1, 4)).toBe(0.25);
    expect(shareOf(0, 0)).toBe(0);
  });
});

describe("report polling", () => {
  it("backs off exponentially up to a cap", () => {
    expect([0, 1, 2, 3, 10].map((n) => nextPollDelay(n, 1000))).toEqual([
      1000, 2000, 4000, 8000, 30_000,
    ]);
  });

  it("knows when a job is finished", () => {
    expect(isTerminalJob("done")).toBe(true);
    expect(isTerminalJob("failed")).toBe(true);
    expect(isTerminalJob("expired")).toBe(true);
    expect(isTerminalJob("queued")).toBe(false);
    expect(isTerminalJob("running")).toBe(false);
  });
});

describe("pollInterval", () => {
  const job = (status: ReportJob["status"]) => ({ status }) as ReportJob;
  const state = (over: object) => ({
    state: {
      data: undefined,
      status: "success" as const,
      dataUpdateCount: 0,
      error: null,
      ...over,
    },
  });

  it("backs off while the job is unfinished and stops once it is done", () => {
    expect(pollInterval(state({ data: job("running"), dataUpdateCount: 2 }), 100)).toBe(400);
    expect(pollInterval(state({ data: job("done") }), 100)).toBe(false);
  });

  it("keeps checking slowly after a network or server error, but stops on a 4xx", () => {
    const network = new ApiClientError(0, { code: "INTERNAL", message: "offline" });
    const gone = new ApiClientError(404, { code: "NOT_FOUND", message: "gone" });
    expect(pollInterval(state({ status: "error", error: network }), 100)).toBe(30_000);
    expect(pollInterval(state({ status: "error", error: gone }), 100)).toBe(false);
  });
});

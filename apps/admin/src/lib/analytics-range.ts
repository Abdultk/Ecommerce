import { AnalyticsInterval, AnalyticsRange } from "@hp/contracts";
import type { z } from "zod";

// Date ranges for analytics and reports. Ranges are whole UTC days (the API reports in
// UTC): `from` is 00:00:00.000 of the first day and `to` is 23:59:59.999 of the last.

export const RANGE_PRESETS = ["7d", "30d", "90d", "month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type Interval = z.infer<typeof AnalyticsInterval>;
export const INTERVALS: readonly Interval[] = AnalyticsInterval.options;

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  custom: "Custom",
};

export const INTERVAL_LABELS: Record<Interval, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export type RangeSelection = Readonly<{ preset: RangePreset; from?: string; to?: string }>;

/** What the API receives: ISO timestamps, as AnalyticsRange accepts them. */
export type ApiRange = Readonly<{ from: string; to: string; interval: Interval }>;

export type ResolvedRange =
  { ok: true; range: ApiRange; days: number } | { ok: false; error: string };

const DAY_MS = 86_400_000;
const PRESET_DAYS: Partial<Record<RangePreset, number>> = { "7d": 7, "30d": 30, "90d": 90 };

/** YYYY-MM-DD of a UTC date. */
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

function presetDays(preset: RangePreset, now: Date): { from: string; to: string } {
  const to = isoDay(now);
  if (preset === "month") return { from: `${to.slice(0, 8)}01`, to };
  const days = PRESET_DAYS[preset] ?? 30;
  return { from: isoDay(new Date(now.getTime() - (days - 1) * DAY_MS)), to };
}

function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

/** Turns a preset or custom dates into the API range, validated by the contract. */
export function resolveRange(
  selection: RangeSelection,
  interval: Interval,
  now: Date,
): ResolvedRange {
  const days =
    selection.preset === "custom"
      ? { from: selection.from ?? "", to: selection.to ?? "" }
      : presetDays(selection.preset, now);
  if (!days.from || !days.to) return { ok: false, error: "Choose a start and an end date." };

  const range: ApiRange = {
    from: `${days.from}T00:00:00.000Z`,
    to: `${days.to}T23:59:59.999Z`,
    interval,
  };
  const parsed = AnalyticsRange.safeParse(range);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the dates." };
  }
  return { ok: true, range, days: dayCount(days.from, days.to) };
}

export function rangeQuery(range: ApiRange): string {
  return new URLSearchParams({
    from: range.from,
    to: range.to,
    interval: range.interval,
  }).toString();
}

// Small numeric helpers for KPI deltas and chart axes.

/** Relative change vs the previous period; null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** The smallest "round" number (1, 2, 2.5 or 5 × 10ⁿ) at or above `value`. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = NICE_STEPS.find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

export function shareOf(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

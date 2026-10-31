import { useId } from "react";
import { formatPercent, percentChange } from "@/lib/analytics-math";

// A KPI with its change vs the previous period. Direction is spelled out in text (and an
// arrow), never conveyed by colour alone.

type KpiCardProps = {
  label: string;
  /** Formatted current value; null shows "Not available". */
  value: string | null;
  current: number | null;
  previous: number | null;
  /** e.g. "previous 30 days" */
  comparison: string;
  /** Shown when the previous period was zero, e.g. "No revenue in the previous period". */
  emptyPrevious: string;
  /** Refund rate going up is bad. */
  higherIsBetter?: boolean;
  note?: string;
};

type Delta = { text: string; spoken: string; tone: string };

function describeDelta(change: number, higherIsBetter: boolean): Delta {
  const pct = formatPercent(Math.abs(change));
  if (change === 0) return { text: "No change", spoken: "No change", tone: "text-muted" };
  const up = change > 0;
  const good = up === higherIsBetter;
  return {
    text: `${up ? "▲" : "▼"} ${pct}`,
    spoken: `${up ? "Up" : "Down"} ${pct}`,
    tone: good ? "text-ok-800" : "text-danger-700",
  };
}

function DeltaLine(props: Required<Omit<KpiCardProps, "label" | "value" | "note">>) {
  const { current, previous, comparison, emptyPrevious, higherIsBetter } = props;
  if (current === null || previous === null) return null;
  const change = percentChange(current, previous);
  if (change === null) return <p className="mt-1 text-xs text-muted">{emptyPrevious}</p>;
  const delta = describeDelta(change, higherIsBetter);
  return (
    <p className={`mt-1 text-xs font-medium ${delta.tone}`}>
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.spoken}</span> vs {comparison}
    </p>
  );
}

export function KpiCard({ label, value, note, higherIsBetter = true, ...rest }: KpiCardProps) {
  const id = useId();
  return (
    <article aria-labelledby={id} className="panel p-4">
      <h3 id={id} className="eyebrow text-muted">
        {label}
      </h3>
      <p className="mt-1 font-display text-3xl text-ink-950 tabular-nums">
        {value ?? "Not available"}
      </p>
      <DeltaLine {...rest} higherIsBetter={higherIsBetter} />
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </article>
  );
}

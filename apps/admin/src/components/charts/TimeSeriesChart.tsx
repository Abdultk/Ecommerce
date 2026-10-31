"use client";

import { useId, useState } from "react";
import { niceCeiling } from "@/lib/analytics-math";

// Hand-rolled, dependency-free SVG chart. The SVG is one role="img" with a text summary as
// its description; every value is also in a data table that screen readers always get and
// sighted users can reveal. All labels are rendered as React text (escaped), never as HTML.

export type ChartPoint = Readonly<{ label: string; value: number }>;

type TimeSeriesChartProps = {
  title: string;
  points: readonly ChartPoint[];
  kind: "line" | "bar";
  formatValue: (n: number) => string;
  formatAxis: (n: number) => string;
  /** "days", "weeks" or "months", used in the summary sentence. */
  periodNoun: string;
  compact?: boolean;
};

const WIDTH = 640;
const PAD = { top: 12, right: 12, bottom: 28, left: 64 };

type Geometry = { height: number; plotW: number; plotH: number; yMax: number };

const yOf = (g: Geometry, v: number) => PAD.top + g.plotH * (1 - v / g.yMax);
const xOf = (g: Geometry, i: number, n: number) =>
  PAD.left + (n === 1 ? g.plotW / 2 : (g.plotW * i) / (n - 1));

function summarize(props: TimeSeriesChartProps): string {
  const { points, formatValue, periodNoun } = props;
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]!);
  return `Total ${formatValue(total)} across ${points.length} ${periodNoun}. Highest: ${formatValue(peak.value)} (${peak.label}).`;
}

function Grid({
  g,
  formatAxis,
  ticks,
}: {
  g: Geometry;
  formatAxis: (n: number) => string;
  ticks: number[];
}) {
  return (
    <g>
      {ticks.map((t) => {
        const y = yOf(g, t * g.yMax);
        return (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="var(--color-line)" />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--color-muted)"
            >
              {formatAxis(t * g.yMax)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ g, points }: { g: Geometry; points: readonly ChartPoint[] }) {
  const n = points.length;
  const indexes = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const anchor = (i: number) => (i === 0 ? "start" : i === n - 1 ? "end" : "middle");
  return (
    <g>
      {indexes.map((i) => (
        <text
          key={i}
          x={n === 1 ? xOf(g, 0, 1) : xOf(g, i, n)}
          y={g.height - 8}
          textAnchor={n === 1 ? "middle" : anchor(i)}
          fontSize="11"
          fill="var(--color-muted)"
        >
          {points[i]!.label}
        </text>
      ))}
    </g>
  );
}

function Marks({ g, props }: { g: Geometry; props: TimeSeriesChartProps }) {
  const { points, kind, formatValue } = props;
  const n = points.length;
  const tip = (p: ChartPoint) => `${p.label}: ${formatValue(p.value)}`;
  if (kind === "bar") {
    const band = g.plotW / n;
    const barW = Math.max(1, band * 0.7);
    return (
      <g fill="var(--color-ember-600)">
        {points.map((p, i) => (
          <rect
            key={p.label}
            x={PAD.left + band * i + (band - barW) / 2}
            y={yOf(g, p.value)}
            width={barW}
            height={Math.max(0, PAD.top + g.plotH - yOf(g, p.value))}
          >
            <title>{tip(p)}</title>
          </rect>
        ))}
      </g>
    );
  }
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(g, i, n)},${yOf(g, p.value)}`);
  return (
    <g>
      <path d={path.join(" ")} fill="none" stroke="var(--color-ember-600)" strokeWidth="2" />
      {points.map((p, i) => (
        <circle
          key={p.label}
          cx={xOf(g, i, n)}
          cy={yOf(g, p.value)}
          r="3"
          fill="var(--color-ember-600)"
        >
          <title>{tip(p)}</title>
        </circle>
      ))}
    </g>
  );
}

function DataTable({
  props,
  id,
  hidden,
}: {
  props: TimeSeriesChartProps;
  id: string;
  hidden: boolean;
}) {
  return (
    <div id={id} className={hidden ? "sr-only" : "mt-3 max-h-72 overflow-auto"}>
      <table className="data-table">
        <caption className="sr-only">{props.title} by period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col" className="text-right">
              {props.title}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.points.map((p) => (
            <tr key={p.label}>
              <th scope="row" className="font-normal">
                {p.label}
              </th>
              <td className="text-right tabular-nums">{props.formatValue(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const { title, points, compact = false } = props;
  const ids = useId();
  const [showTable, setShowTable] = useState(false);
  const height = compact ? 160 : 220;
  const g: Geometry = {
    height,
    plotW: WIDTH - PAD.left - PAD.right,
    plotH: height - PAD.top - PAD.bottom,
    yMax: niceCeiling(Math.max(0, ...points.map((p) => p.value))),
  };
  const ticks = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="panel p-4" aria-labelledby={`${ids}-title`}>
      <div className="flex items-baseline justify-between gap-3">
        <figcaption id={`${ids}-title`} className="eyebrow text-muted">
          {title}
        </figcaption>
        {points.length > 0 && (
          <button
            type="button"
            className="btn-link text-xs"
            aria-expanded={showTable}
            aria-controls={`${ids}-table`}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? "Hide data table" : "Show data table"}
          </button>
        )}
      </div>
      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No sales in this range.</p>
      ) : (
        <>
          <p id={`${ids}-summary`} className="sr-only">
            {summarize(props)}
          </p>
          <svg
            role="img"
            aria-labelledby={`${ids}-title`}
            aria-describedby={`${ids}-summary`}
            viewBox={`0 0 ${WIDTH} ${height}`}
            className="mt-2 h-auto w-full"
          >
            <Grid g={g} formatAxis={props.formatAxis} ticks={ticks} />
            <Marks g={g} props={props} />
            <XLabels g={g} points={points} />
          </svg>
          <DataTable props={props} id={`${ids}-table`} hidden={!showTable} />
        </>
      )}
    </figure>
  );
}

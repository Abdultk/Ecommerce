"use client";

import { useId } from "react";
import {
  INTERVAL_LABELS,
  INTERVALS,
  PRESET_LABELS,
  RANGE_PRESETS,
  type Interval,
  type RangePreset,
  type RangeSelection,
} from "@/lib/analytics-range";

type RangeControlsProps = {
  selection: RangeSelection;
  onChange: (next: RangeSelection) => void;
  /** Shown under the dates, announced as an alert. */
  error?: string | null;
};

const isPreset = (value: string): value is RangePreset =>
  (RANGE_PRESETS as readonly string[]).includes(value);

/** Preset select plus From/To dates for a custom range (whole UTC days). */
export function RangeControls({ selection, onChange, error = null }: RangeControlsProps) {
  const ids = useId();
  const custom = selection.preset === "custom";
  const errorId = `${ids}-error`;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`${ids}-preset`} className="field-label">
          Range
        </label>
        <select
          id={`${ids}-preset`}
          className="field"
          value={selection.preset}
          onChange={(e) => {
            if (isPreset(e.target.value)) onChange({ ...selection, preset: e.target.value });
          }}
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      {custom &&
        (["from", "to"] as const).map((field) => (
          <div key={field}>
            <label htmlFor={`${ids}-${field}`} className="field-label">
              {field === "from" ? "From" : "To"}
            </label>
            <input
              id={`${ids}-${field}`}
              type="date"
              className="field"
              value={selection[field] ?? ""}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => onChange({ ...selection, [field]: e.target.value || undefined })}
            />
          </div>
        ))}
      {error && (
        <p id={errorId} role="alert" className="error-text basis-full">
          {error}
        </p>
      )}
    </div>
  );
}

type IntervalSwitchProps = { value: Interval; onChange: (next: Interval) => void };

/** Native radios: arrow keys move between options, Tab leaves the group. */
export function IntervalSwitch({ value, onChange }: IntervalSwitchProps) {
  const name = useId();
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="field-label">Group by</legend>
      {INTERVALS.map((interval) => (
        <label key={interval} className="check-label">
          <input
            type="radio"
            className="check"
            name={name}
            value={interval}
            checked={value === interval}
            onChange={() => onChange(interval)}
          />
          {INTERVAL_LABELS[interval]}
        </label>
      ))}
    </fieldset>
  );
}

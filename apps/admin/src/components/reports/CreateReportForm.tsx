"use client";

import { useId, useState, type FormEvent } from "react";
import { ReportFormat, ReportType, type ReportJob } from "@hp/contracts";
import { RangeControls } from "@/components/analytics/RangeControls";
import { resolveRange, type RangeSelection } from "@/lib/analytics-range";
import { errorMessage } from "@/lib/session";
import { FORMAT_LABELS, REPORT_TYPE_LABELS } from "./report-labels";
import { useCreateReport } from "./use-reports";

type CreateReportFormProps = { onCreated: (job: ReportJob) => void };

/** Type, format and range (whole UTC days); the inventory snapshot ignores the range. */
export function CreateReportForm({ onCreated }: CreateReportFormProps) {
  const ids = useId();
  const create = useCreateReport();
  const [type, setType] = useState<ReportType>("orders");
  const [format, setFormat] = useState<ReportFormat>("csv");
  const [selection, setSelection] = useState<RangeSelection>({ preset: "30d" });
  const [rangeError, setRangeError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolved = resolveRange(selection, "day", new Date());
    if (!resolved.ok) {
      setRangeError(resolved.error);
      return;
    }
    setRangeError(null);
    create.mutate({ type, format, range: resolved.range }, { onSuccess: onCreated });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="panel space-y-4 p-4">
      <h2 className="eyebrow text-muted">New report</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${ids}-type`} className="field-label">
            Report
          </label>
          <select
            id={`${ids}-type`}
            className="field"
            value={type}
            onChange={(e) => setType(ReportType.parse(e.target.value))}
          >
            {ReportType.options.map((t) => (
              <option key={t} value={t}>
                {REPORT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-format`} className="field-label">
            Format
          </label>
          <select
            id={`${ids}-format`}
            className="field"
            value={format}
            onChange={(e) => setFormat(ReportFormat.parse(e.target.value))}
          >
            {ReportFormat.options.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <RangeControls selection={selection} onChange={setSelection} error={rangeError} />
      </div>
      {type === "inventory" && (
        <p className="text-xs text-muted">
          Inventory is a snapshot of current stock; the range is ignored.
        </p>
      )}
      {create.isError && (
        <p role="alert" className="error-text">
          {errorMessage(create.error)}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create report"}
      </button>
    </form>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { ReportJob } from "@hp/contracts";
import { formatCount, formatDate, formatDateTime } from "@/lib/format";
import { isTerminalJob } from "@/lib/report-polling";
import { errorMessage } from "@/lib/session";
import { FORMAT_SHORT, REPORT_TYPE_LABELS, STATUS_LABELS } from "./report-labels";
import { useReportJob, useReportList } from "./use-reports";

const STATUS_BADGE: Record<ReportJob["status"], string> = {
  queued: "badge-neutral",
  running: "badge-neutral",
  done: "badge-ok",
  failed: "badge-warn",
  expired: "badge-neutral",
};

/** `to` is exclusive in the contract, so the last day shown is the millisecond before it. */
function rangeText(job: ReportJob): string {
  if (job.type === "inventory") return "Snapshot";
  const lastDay = new Date(Date.parse(job.range.to) - 1).toISOString();
  return `${formatDate(job.range.from)} – ${formatDate(lastDay)}`;
}

const linkExpired = (job: ReportJob) =>
  job.downloadExpiresAt !== null && Date.parse(job.downloadExpiresAt) <= Date.now();

function FileCell({ job, refresh, busy }: { job: ReportJob; refresh: () => void; busy: boolean }) {
  const label = `${REPORT_TYPE_LABELS[job.type]} (${FORMAT_SHORT[job.format]})`;
  if (job.status === "failed") return <span className="text-muted">—</span>;
  // Files are deleted after the retention period; the job stays as a record.
  if (job.status === "expired") return <span className="text-muted">File removed</span>;
  if (job.status !== "done") return <span className="text-muted">Preparing…</span>;
  if (!job.downloadUrl || linkExpired(job)) {
    return (
      <button type="button" className="btn-link text-sm" disabled={busy} onClick={refresh}>
        Get a new link<span className="sr-only"> for {REPORT_TYPE_LABELS[job.type]}</span>
      </button>
    );
  }
  return (
    <a href={job.downloadUrl} rel="noopener noreferrer" download className="btn-link text-sm">
      Download<span className="sr-only"> {label}</span>
    </a>
  );
}

type RowProps = { listed: ReportJob; pollBaseMs: number; onFinished: (job: ReportJob) => void };

function ReportJobRow({ listed, pollBaseMs, onFinished }: RowProps) {
  const { job, refresh, isRefreshing } = useReportJob(listed, pollBaseMs);
  const wasPending = !isTerminalJob(listed.status);
  const announced = useRef(false);

  useEffect(() => {
    if (announced.current || !wasPending || !isTerminalJob(job.status)) return;
    announced.current = true;
    onFinished(job);
  }, [wasPending, job, onFinished]);

  return (
    <tr>
      <td>
        <span className="block font-medium text-ink-950">{REPORT_TYPE_LABELS[job.type]}</span>
        <span className="text-xs text-muted">{FORMAT_SHORT[job.format]}</span>
      </td>
      <td className="whitespace-nowrap">{rangeText(job)}</td>
      <td>
        <span className="block whitespace-nowrap">{formatDateTime(job.createdAt)}</span>
        {job.requestedByEmail && <span className="text-xs text-muted">{job.requestedByEmail}</span>}
      </td>
      <td>
        <span className={`badge ${STATUS_BADGE[job.status]}`}>{STATUS_LABELS[job.status]}</span>
        {job.status === "failed" && job.error && (
          <span className="mt-1 block text-xs text-danger-800">{job.error}</span>
        )}
        {job.status === "done" && job.rowCount !== null && (
          <span className="mt-1 block text-xs text-muted">{formatCount(job.rowCount)} rows</span>
        )}
      </td>
      <td>
        <FileCell job={job} refresh={() => void refresh()} busy={isRefreshing} />
      </td>
    </tr>
  );
}

type TableProps = { pollBaseMs: number; onFinished: (job: ReportJob) => void };

export function ReportJobsTable({ pollBaseMs, onFinished }: TableProps) {
  const list = useReportList();
  if (list.isPending) return <p className="panel p-4 text-sm text-muted">Loading reports…</p>;
  if (list.isError) {
    return (
      <p role="alert" className="error-text panel p-4">
        {errorMessage(list.error)}
      </p>
    );
  }
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
        <caption className="sr-only">Recent reports</caption>
        <thead>
          <tr>
            <th scope="col">Report</th>
            <th scope="col">Range</th>
            <th scope="col">Requested</th>
            <th scope="col">Status</th>
            <th scope="col">File</th>
          </tr>
        </thead>
        <tbody>
          {list.data.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted">
                No reports yet.
              </td>
            </tr>
          ) : (
            list.data.map((job) => (
              <ReportJobRow
                key={job.id}
                listed={job}
                pollBaseMs={pollBaseMs}
                onFinished={onFinished}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

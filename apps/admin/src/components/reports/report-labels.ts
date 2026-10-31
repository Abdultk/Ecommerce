import type { ReportFormat, ReportJob, ReportStatus, ReportType } from "@hp/contracts";

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  orders: "Orders",
  "sales-by-day": "Sales by day",
  inventory: "Inventory snapshot",
  customers: "Customers",
};

export const FORMAT_LABELS: Record<ReportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel (XLSX)",
};

export const FORMAT_SHORT: Record<ReportFormat, string> = { csv: "CSV", xlsx: "XLSX" };

export const STATUS_LABELS: Record<ReportStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Ready",
  failed: "Failed",
  expired: "Expired",
};

/** "Orders report (CSV)" */
export const reportName = (job: Pick<ReportJob, "type" | "format">): string =>
  `${REPORT_TYPE_LABELS[job.type]} report (${FORMAT_SHORT[job.format]})`;

/** Announced in the page's live region when a polled job finishes. */
export function finishedMessage(job: ReportJob): string {
  return job.status === "done"
    ? `${reportName(job)} is ready.`
    : `${reportName(job)} failed: ${job.error ?? "Try again."}`;
}

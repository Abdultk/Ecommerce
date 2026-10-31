import type { ReportJob as ReportJobRow } from "@prisma/client";
import type { ReportFormat, ReportJob, ReportType } from "@hp/contracts";
import type { ReportStorage } from "../../lib/report-storage";
import { isPastRetention } from "./report-retention";

export type ReportRowWithRequester = ReportJobRow & { requestedBy: { email: string } | null };

const STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  EXPIRED: "expired",
} as const;

/** e.g. hearth-and-pan-orders-2026-09-01.csv (only [A-Za-z0-9._-]). */
export const downloadName = (job: Pick<ReportJobRow, "type" | "format" | "rangeFrom">) =>
  `hearth-and-pan-${job.type}-${job.rangeFrom.toISOString().slice(0, 10)}.${job.format}`;

/**
 * The contract view. A fresh short-lived link is signed on every read of a DONE job that is
 * still within retention; expired (or overdue) reports get none.
 */
export async function toReportJob(
  job: ReportRowWithRequester,
  storage: ReportStorage,
): Promise<ReportJob> {
  const link =
    job.status === "DONE" && job.storageKey && !isPastRetention(job.completedAt)
      ? await storage.downloadUrl(job.storageKey, downloadName(job))
      : null;
  return {
    id: job.id,
    type: job.type as ReportType,
    format: job.format as ReportFormat,
    status: STATUS[job.status],
    range: { from: job.rangeFrom.toISOString(), to: job.rangeTo.toISOString() },
    rowCount: job.rowCount,
    error: job.error,
    downloadUrl: link?.url ?? null,
    downloadExpiresAt: link?.expiresAt.toISOString() ?? null,
    requestedByEmail: job.requestedBy?.email ?? null,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

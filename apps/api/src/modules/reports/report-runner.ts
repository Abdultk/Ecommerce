import { randomBytes } from "node:crypto";
import type { ReportFormat, ReportType } from "@hp/contracts";
import { logger } from "../../lib/logger";
import type { Db } from "../../lib/prisma";
import type { ReportStorage } from "../../lib/report-storage";
import { safeErrorFields } from "../../lib/safe-error";
import { toCsv } from "./csv";
import { ReportError, buildReportData } from "./report-data";
import { toXlsx } from "./xlsx";

export type ReportDeps = { db: Db; storage: ReportStorage };

export const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const GENERIC_FAILURE = "The report couldn't be generated. Please try again.";
/** A RUNNING job older than this was abandoned by a crashed worker and may be retried. */
const STALE_RUN_MS = 10 * 60_000;

/** Moves QUEUED (or abandoned RUNNING) to RUNNING atomically, so only one runner works on it. */
async function claim(db: Db, reportId: string, now: Date): Promise<boolean> {
  const { count } = await db.reportJob.updateMany({
    where: {
      id: reportId,
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
      ],
    },
    data: { status: "RUNNING", startedAt: now },
  });
  return count === 1;
}

async function render(format: ReportFormat, table: Awaited<ReturnType<typeof buildReportData>>) {
  return format === "csv"
    ? Buffer.from(toCsv(table.columns, table.rows), "utf8")
    : toXlsx(table.columns, table.rows);
}

/**
 * Generates one report: builds the rows, renders CSV or XLSX, stores the file privately and
 * marks the job DONE. Any failure marks it FAILED with a user-safe message; details are
 * logged without error messages (which can hold customer data).
 */
export async function runReport(
  deps: ReportDeps,
  reportId: string,
  now = new Date(),
): Promise<void> {
  if (!(await claim(deps.db, reportId, now))) return;
  const job = await deps.db.reportJob.findUnique({ where: { id: reportId } });
  if (!job) return; // deleted (e.g. its requester was removed) since it was claimed
  const format = job.format as ReportFormat;
  try {
    const table = await buildReportData(deps.db, job.type as ReportType, {
      from: job.rangeFrom,
      end: job.rangeTo,
    });
    const key = `reports/${job.id}-${randomBytes(16).toString("hex")}.${format}`;
    await deps.storage.put(key, await render(format, table), CONTENT_TYPES[format]);
    // updateMany: a job deleted mid-run is simply gone, not an error.
    await deps.db.reportJob.updateMany({
      where: { id: job.id },
      data: {
        status: "DONE",
        storageKey: key,
        rowCount: table.rows.length,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    logger.error({ err: safeErrorFields(err), reportId }, "report generation failed");
    await deps.db.reportJob.updateMany({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: err instanceof ReportError ? err.message : GENERIC_FAILURE,
        completedAt: new Date(),
      },
    });
  }
}

import { logger } from "../../lib/logger";
import type { Db } from "../../lib/prisma";
import type { ReportStorage } from "../../lib/report-storage";
import { safeErrorFields } from "../../lib/safe-error";

/** Report files hold customer data, so they are deleted this long after they were made. */
export const REPORT_RETENTION_MS = 7 * 24 * 3_600_000;
const PURGE_BATCH = 100;

/** True when a finished report is past retention (its link must no longer be signed). */
export const isPastRetention = (completedAt: Date | null, now: Date = new Date()): boolean =>
  completedAt !== null && now.getTime() - completedAt.getTime() > REPORT_RETENTION_MS;

/**
 * Deletes report files past retention and marks their jobs EXPIRED (the row stays, so the
 * reports page still shows the history). A file that can't be deleted is retried next run.
 * Runs with the worker's hourly purge. Returns how many reports were expired.
 */
export async function purgeExpiredReports(
  db: Db,
  storage: ReportStorage,
  now: Date = new Date(),
): Promise<number> {
  const due = await db.reportJob.findMany({
    where: {
      status: "DONE",
      completedAt: { lt: new Date(now.getTime() - REPORT_RETENTION_MS) },
    },
    select: { id: true, storageKey: true },
    orderBy: { completedAt: "asc" },
    take: PURGE_BATCH,
  });
  let expired = 0;
  for (const job of due) {
    try {
      if (job.storageKey) await storage.delete(job.storageKey);
      await db.reportJob.update({
        where: { id: job.id },
        data: { status: "EXPIRED", storageKey: null },
      });
      expired += 1;
    } catch (err) {
      logger.error({ err: safeErrorFields(err), reportId: job.id }, "could not expire report");
    }
  }
  return expired;
}

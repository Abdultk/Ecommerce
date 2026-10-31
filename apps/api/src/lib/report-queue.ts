import { Queue } from "bullmq";
import { connectionFrom } from "./queue";

export const REPORT_QUEUE = "reports";
export type ReportJobData = { reportId: string };

const KEEP_FAILED_JOBS = 100;

/** Hands a report job to whatever generates it. */
export interface ReportQueue {
  enqueue(reportId: string): Promise<void>;
}

/** Production: the worker process generates reports from Redis. */
export function createBullReportQueue(redisUrl: string): ReportQueue & { close(): Promise<void> } {
  const queue = new Queue<ReportJobData>(REPORT_QUEUE, { connection: connectionFrom(redisUrl) });
  return {
    async enqueue(reportId) {
      // The job id is the report id, so a double enqueue can't run the same report twice.
      await queue.add(
        "export",
        { reportId },
        {
          jobId: reportId,
          removeOnComplete: true,
          removeOnFail: KEEP_FAILED_JOBS,
        },
      );
    },
    close: () => queue.close(),
  };
}

/**
 * Without Redis (local runs, tests): generate in this process after the response, the same
 * way email falls back to sending inline. `drain()` waits for everything queued so far.
 */
export function createInlineReportQueue(
  run: (reportId: string) => Promise<void>,
  onError: (err: unknown, reportId: string) => void,
): ReportQueue & { drain(): Promise<void> } {
  const pending = new Set<Promise<void>>();
  return {
    async enqueue(reportId) {
      const task = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => run(reportId))
        .catch((err: unknown) => onError(err, reportId))
        .finally(() => pending.delete(task));
      pending.add(task);
    },
    async drain() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

import type { ReportJob } from "@hp/contracts";

// Report jobs are polled while queued or running: exponential backoff from a base delay,
// capped, and stopped once the job is done or failed. TanStack Query pauses interval
// refetches while the tab is hidden (refetchIntervalInBackground is left off).

export const DEFAULT_POLL_BASE_MS = 2_000;
export const MAX_POLL_MS = 30_000;

export function nextPollDelay(attempt: number, baseMs: number = DEFAULT_POLL_BASE_MS): number {
  return Math.min(baseMs * 2 ** attempt, MAX_POLL_MS);
}

export function isTerminalJob(status: ReportJob["status"]): boolean {
  return status === "done" || status === "failed" || status === "expired";
}

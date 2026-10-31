"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@hp/api-client";
import { ReportJob, type ReportFormat, type ReportType } from "@hp/contracts";
import { z } from "zod";
import type { ApiRange } from "@/lib/analytics-range";
import { REPORTS_KEY, reportJobKey } from "@/lib/query-keys";
import {
  DEFAULT_POLL_BASE_MS,
  MAX_POLL_MS,
  isTerminalJob,
  nextPollDelay,
} from "@/lib/report-polling";
import { useSession } from "@/lib/session";

// Report jobs (analytics:export): create, list, and poll one job until it finishes.

export type NewReport = Readonly<{ type: ReportType; format: ReportFormat; range: ApiRange }>;

const LIST_KEY = [...REPORTS_KEY, "list"] as const;
const LIST_PAGE_SIZE = 20;

export function useCreateReport() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: NewReport) =>
      (await api.post("/admin/reports", request, ReportJob)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useReportList() {
  const { api } = useSession();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async () =>
      (await api.get(`/admin/reports?pageSize=${LIST_PAGE_SIZE}`, z.array(ReportJob))).data,
  });
}

type PolledQuery = {
  state: {
    data?: ReportJob;
    status: "pending" | "error" | "success";
    dataUpdateCount: number;
    error: unknown;
  };
};

/** Poll delay for a job query: backoff while queued/running, stop when finished or gone. */
export function pollInterval(query: PolledQuery, baseMs: number): number | false {
  const job = query.state.data;
  if (query.state.status === "error") {
    // A 4xx (job gone, access revoked) won't fix itself; network and 5xx errors might.
    const { error } = query.state;
    const clientError =
      error instanceof ApiClientError && error.status >= 400 && error.status < 500;
    return clientError ? false : MAX_POLL_MS;
  }
  if (job && isTerminalJob(job.status)) return false;
  return nextPollDelay(query.state.dataUpdateCount, baseMs);
}

/**
 * The live state of one job. Unfinished jobs are polled (paused while the tab is hidden,
 * since refetchIntervalInBackground is off); finished ones are only refetched on demand,
 * e.g. to get a fresh signed download link.
 */
export function useReportJob(job: ReportJob, baseMs: number = DEFAULT_POLL_BASE_MS) {
  const { api } = useSession();
  const query = useQuery({
    queryKey: reportJobKey(job.id),
    queryFn: async () =>
      (await api.get(`/admin/reports/${encodeURIComponent(job.id)}`, ReportJob)).data,
    enabled: !isTerminalJob(job.status),
    refetchInterval: (q) => pollInterval(q, baseMs),
    refetchOnWindowFocus: false,
  });
  return { job: query.data ?? job, refresh: query.refetch, isRefreshing: query.isFetching };
}

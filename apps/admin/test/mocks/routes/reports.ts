import { http } from "msw";
import { ReportJobQuery, ReportRequest, type ReportJob } from "@hp/contracts";
import { FIXTURE_CDN_URL } from "@/lib/config";
import {
  authorize,
  errorResponse,
  invalid,
  okResponse,
  pagedResponse,
  queryOf,
  readJson,
  replaceById,
  type MockContext,
} from "../http";
import type { MockUser } from "../types";

// Mirrors apps/api/src/modules/admin/reports.admin.ts (analytics:export). The real API
// queues a worker job; here each status read advances queued → running → done, so the UI's
// polling can be exercised. Reading a done job re-signs its short-lived download link.

const DAY_MS = 86_400_000;
const LINK_TTL_MS = 15 * 60_000;
const MOCK_ROW_COUNT = 42;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const NEXT_STATUS: Record<ReportJob["status"], ReportJob["status"]> = {
  queued: "running",
  running: "done",
  done: "done",
  failed: "failed",
  expired: "expired",
};

/** Contract: `to` is exclusive, so a date-only end becomes the next midnight. */
function resolvedTo(raw: unknown, parsed: Date): string {
  const exclusive =
    typeof raw === "string" && DATE_ONLY.test(raw) ? parsed.getTime() + DAY_MS : parsed.getTime();
  return new Date(exclusive).toISOString();
}

function advance(ctx: MockContext, job: ReportJob): ReportJob {
  const status = NEXT_STATUS[job.status];
  if (status !== "done") return { ...job, status };
  const now = ctx.now();
  return {
    ...job,
    status,
    rowCount: job.rowCount ?? MOCK_ROW_COUNT,
    downloadUrl: `${FIXTURE_CDN_URL}/reports/${job.id}.${job.format}`,
    downloadExpiresAt: new Date(Date.parse(now) + LINK_TTL_MS).toISOString(),
    completedAt: job.completedAt ?? now,
  };
}

const visibleTo = (caller: MockUser, job: ReportJob) =>
  caller.user.role === "SUPER_ADMIN" || job.requestedByEmail === caller.user.email;

function createJob(ctx: MockContext, caller: MockUser, body: unknown, input: ReportRequest) {
  const rawTo = (body as { range?: { to?: unknown } }).range?.to;
  return {
    id: ctx.nextId("rep"),
    type: input.type,
    format: input.format,
    status: "queued",
    range: { from: input.range.from.toISOString(), to: resolvedTo(rawTo, input.range.to) },
    rowCount: null,
    error: null,
    downloadUrl: null,
    downloadExpiresAt: null,
    requestedByEmail: caller.user.email,
    createdAt: ctx.now(),
    completedAt: null,
  } satisfies ReportJob;
}

export function reportRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  return [
    http.get(`${baseUrl}/admin/reports`, ({ request }) => {
      const caller = authorize(ctx, request, "analytics:export");
      if (caller instanceof Response) return caller;
      const query = ReportJobQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const jobs = store.get().reports.filter((job) => visibleTo(caller, job));
      return pagedResponse(jobs, query.data.page, query.data.pageSize);
    }),

    http.post(`${baseUrl}/admin/reports`, async ({ request }) => {
      const caller = authorize(ctx, request, "analytics:export");
      if (caller instanceof Response) return caller;
      const body = await readJson(request);
      const input = ReportRequest.safeParse(body);
      if (!input.success) return invalid(input.error);
      const job = createJob(ctx, caller, body, input.data);
      store.update((db) => ({ ...db, reports: [job, ...db.reports] }));
      return okResponse(job, 202);
    }),

    http.get(`${baseUrl}/admin/reports/:jobId`, ({ request, params }) => {
      const caller = authorize(ctx, request, "analytics:export");
      if (caller instanceof Response) return caller;
      const job = store.get().reports.find((r) => r.id === params.jobId);
      if (!job || !visibleTo(caller, job)) return errorResponse("NOT_FOUND", "Report not found.");
      const next = advance(ctx, job);
      store.update((db) => ({ ...db, reports: replaceById(db.reports, next) }));
      return okResponse(next);
    }),
  ];
}

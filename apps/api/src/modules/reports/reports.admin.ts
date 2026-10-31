import { Router, type Request } from "express";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { ReportJobQuery, ReportRequest, ok, paged } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { pathParam } from "../../lib/params";
import { prisma } from "../../lib/prisma";
import { rateLimit } from "../../lib/rate-limit";
import type { ReportQueue } from "../../lib/report-queue";
import type { ReportStorage } from "../../lib/report-storage";
import { requirePermission } from "../../middleware/authenticate";
import { audit } from "../admin/audit";
import { resolveRange } from "../admin/analytics/analytics.admin";
import { toReportJob } from "./report-view";

export type ReportsDeps = {
  storage: ReportStorage;
  queue: ReportQueue;
  createLimiter: RateLimiterAbstract;
};

const WITH_REQUESTER = { requestedBy: { select: { email: true } } } as const;
const NOT_FOUND = "Report not found.";

/** Requester-only (SUPER_ADMIN sees all); others get 404 so job ids can't be probed. */
const visibleTo = (req: Request) =>
  req.user!.role === "SUPER_ADMIN" ? {} : { requestedById: req.user!.sub };

/** /admin/reports: queued CSV/XLSX exports (analytics:export). */
export function reportsAdminRouter(deps: ReportsDeps): Router {
  const router = Router();
  router.use(requirePermission("analytics:export"));

  router.post(
    "/",
    rateLimit(deps.createLimiter, (req) => `user:${req.user!.sub}`),
    async (req, res) => {
      const input = ReportRequest.parse(req.body);
      const range = resolveRange(input.range);
      const job = await prisma.$transaction(async (tx) => {
        const created = await tx.reportJob.create({
          data: {
            requestedById: req.user!.sub,
            type: input.type,
            format: input.format,
            rangeFrom: range.from,
            rangeTo: range.end,
          },
          include: WITH_REQUESTER,
        });
        // Exports copy customer data out of the system, so each one is on the audit log.
        await audit(tx, req, {
          action: "report.create",
          entity: "ReportJob",
          entityId: created.id,
          after: { type: input.type, format: input.format, from: range.from, to: range.end },
        });
        return created;
      });
      try {
        await deps.queue.enqueue(job.id);
      } catch (err) {
        await prisma.reportJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: "The report couldn't be queued. Please try again." },
        });
        throw err;
      }
      res.status(202).json(ok(await toReportJob(job, deps.storage)));
    },
  );

  router.get("/", async (req, res) => {
    const query = ReportJobQuery.parse(req.query);
    const where = visibleTo(req);
    const [jobs, total] = await Promise.all([
      prisma.reportJob.findMany({
        where,
        include: WITH_REQUESTER,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.reportJob.count({ where }),
    ]);
    const items = await Promise.all(jobs.map((j) => toReportJob(j, deps.storage)));
    res.json(paged(items, { page: query.page, pageSize: query.pageSize, total }));
  });

  router.get("/:jobId", async (req, res) => {
    const job = await prisma.reportJob.findFirst({
      where: { id: pathParam(req, "jobId"), ...visibleTo(req) },
      include: WITH_REQUESTER,
    });
    if (!job) throw new AppError("NOT_FOUND", NOT_FOUND);
    res.json(ok(await toReportJob(job, deps.storage)));
  });

  return router;
}

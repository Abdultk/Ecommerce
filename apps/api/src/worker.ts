import { Queue, Worker } from "bullmq";
import { env } from "./config/env";
import { paymentsFromEnv, reportStorageFromEnv } from "./app";
import { logger } from "./lib/logger";
import { createSmtpMailer, type Mailer, type OutgoingMail } from "./lib/mailer";
import { prisma } from "./lib/prisma";
import {
  EMAIL_QUEUE,
  MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
  connectionFrom,
  createQueueMailer,
} from "./lib/queue";
import { REPORT_QUEUE, type ReportJobData } from "./lib/report-queue";
import type { ReportStorage } from "./lib/report-storage";
import { safeErrorFields } from "./lib/safe-error";
import { captureJobFailure, initSentry, withCronMonitor } from "./lib/sentry";
import { purgeExpiredCarts, purgeIdempotencyRecords } from "./modules/maintenance/jobs";
import { sendLowStockAlerts } from "./modules/maintenance/low-stock-alert";
import { collectOpsMetrics, type QueueProbe } from "./modules/maintenance/ops-metrics";
import { releaseExpiredReservations, type OrderDeps } from "./modules/orders/orders.service";
import { reconcilePayments } from "./modules/payments/reconcile-payments";
import { purgeExpiredReports } from "./modules/reports/report-retention";
import { runReport } from "./modules/reports/report-runner";

const MINUTE_MS = 60_000;
const EMAIL_CONCURRENCY = 5;
const REPORT_CONCURRENCY = 2;
const KEEP_FAILED_JOBS = 100;

/** Repeat interval per maintenance job. Reconciliation needs a real provider to ask. */
const SCHEDULE: Readonly<Record<string, number>> = {
  [MAINTENANCE_JOBS.releaseExpiredReservations]: MINUTE_MS,
  [MAINTENANCE_JOBS.purgeExpiredCarts]: 60 * MINUTE_MS,
  [MAINTENANCE_JOBS.lowStockAlert]: 10 * MINUTE_MS,
  [MAINTENANCE_JOBS.opsMetrics]: 5 * MINUTE_MS,
  ...(env.PAYMENT_PROVIDER !== "fake" && {
    [MAINTENANCE_JOBS.reconcilePayments]: 15 * MINUTE_MS,
  }),
};

type Deps = {
  orders: OrderDeps;
  reportStorage: ReportStorage;
  /** Enqueues mail onto the email queue (retried there), never sending inline. */
  queuedMail: Mailer;
  probes: QueueProbe[];
};

const probe = (queue: Queue): QueueProbe => ({
  name: queue.name,
  counts: () => queue.getJobCounts("waiting", "active", "delayed", "failed"),
  async oldestWaitingAt() {
    const [oldest] = await queue.getJobs(["wait"], 0, 0, true);
    return oldest ? new Date(oldest.timestamp) : null;
  },
});

/** Upserts one scheduler per job and removes any left over from older deploys. */
async function scheduleJobs(maintenance: Queue): Promise<void> {
  for (const legacy of await maintenance.getRepeatableJobs()) {
    await maintenance.removeRepeatableByKey(legacy.key);
  }
  for (const scheduler of await maintenance.getJobSchedulers()) {
    if (scheduler.key && !(scheduler.key in SCHEDULE)) {
      await maintenance.removeJobScheduler(scheduler.key);
    }
  }
  for (const [name, every] of Object.entries(SCHEDULE)) {
    await maintenance.upsertJobScheduler(
      name,
      { every },
      { name, data: {}, opts: { removeOnComplete: true, removeOnFail: KEEP_FAILED_JOBS } },
    );
  }
}

/** The hourly purges are independent: one failing must not skip the others. */
async function hourlyPurge(deps: Deps) {
  const names = ["carts", "idempotencyRecords", "reports"] as const;
  const results = await Promise.allSettled([
    purgeExpiredCarts(prisma),
    purgeIdempotencyRecords(prisma),
    purgeExpiredReports(prisma, deps.reportStorage),
  ]);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.error({ err: safeErrorFields(r.reason), purge: names[i] }, "purge failed");
    }
  });
  if (results.some((r) => r.status === "rejected")) throw new Error("A purge failed");
}

function buildHandlers(deps: Deps): Record<string, () => Promise<unknown>> {
  const alertExtra = env.LOW_STOCK_ALERT_EMAIL ? [env.LOW_STOCK_ALERT_EMAIL] : [];
  return {
    [MAINTENANCE_JOBS.releaseExpiredReservations]: () =>
      withCronMonitor({ name: "release-expired-reservations", crontab: "* * * * *" }, () =>
        releaseExpiredReservations({ ...deps.orders, mailer: deps.queuedMail }),
      ),
    [MAINTENANCE_JOBS.purgeExpiredCarts]: () =>
      withCronMonitor({ name: "purge-expired-carts", crontab: "0 * * * *" }, () =>
        hourlyPurge(deps),
      ),
    [MAINTENANCE_JOBS.lowStockAlert]: () => sendLowStockAlerts(prisma, deps.queuedMail, alertExtra),
    [MAINTENANCE_JOBS.reconcilePayments]: () => reconcilePayments(deps.orders),
    [MAINTENANCE_JOBS.opsMetrics]: async () => {
      logger.info({ metrics: await collectOpsMetrics(prisma, deps.probes) }, "ops.metrics");
    },
  };
}

function startWorkers(
  connection: ReturnType<typeof connectionFrom>,
  smtp: Mailer,
  deps: Deps,
): Worker[] {
  const handlers = buildHandlers(deps);
  const workers = [
    new Worker<OutgoingMail>(EMAIL_QUEUE, async (job) => smtp.send(job.data), {
      connection,
      concurrency: EMAIL_CONCURRENCY,
    }),
    new Worker<ReportJobData>(
      REPORT_QUEUE,
      (job) => runReport({ db: prisma, storage: deps.reportStorage }, job.data.reportId),
      { connection, concurrency: REPORT_CONCURRENCY },
    ),
    new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        const handler = handlers[job.name];
        if (!handler) throw new Error(`Unknown maintenance job: ${job.name}`);
        await handler();
      },
      { connection, concurrency: 1 },
    ),
  ];
  for (const worker of workers) {
    // Job data can hold reset tokens, so only the job id and safe error fields are logged.
    worker.on("failed", (job, err) => {
      logger.error({ jobId: job?.id, queue: worker.name, err: safeErrorFields(err) }, "job failed");
      captureJobFailure(err, worker.name);
    });
  }
  return workers;
}

/**
 * Background process: sends queued email, generates report exports and runs scheduled
 * maintenance. Started separately from the API (`pnpm --filter @hp/api worker`).
 */
async function main() {
  if (!env.REDIS_URL) throw new Error("The worker needs REDIS_URL");
  initSentry({
    service: "worker",
    dsn: env.SENTRY_DSN,
    release: env.RENDER_GIT_COMMIT,
    nodeEnv: env.NODE_ENV,
  });
  const connection = connectionFrom(env.REDIS_URL);
  const smtp = createSmtpMailer(env.SMTP_URL, env.MAIL_FROM, logger);
  const queuedMail = createQueueMailer(env.REDIS_URL);
  const queues = [EMAIL_QUEUE, MAINTENANCE_QUEUE, REPORT_QUEUE].map(
    (name) => new Queue(name, { connection }),
  );
  await scheduleJobs(queues[1]!);
  const workers = startWorkers(connection, smtp, {
    orders: { db: prisma, payments: paymentsFromEnv(), mailer: smtp },
    reportStorage: reportStorageFromEnv(),
    queuedMail,
    probes: queues.map(probe),
  });
  logger.info("worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      ...queues.map((q) => q.close()),
      queuedMail.close(),
    ]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.fatal({ err: safeErrorFields(err) }, "worker failed to start");
  process.exit(1);
});

import { Queue } from "bullmq";
import type { Mailer, OutgoingMail } from "./mailer";

export const EMAIL_QUEUE = "email";
export const MAINTENANCE_QUEUE = "maintenance";

export const MAINTENANCE_JOBS = {
  releaseExpiredReservations: "release-expired-reservations",
  purgeExpiredCarts: "purge-expired-carts",
  lowStockAlert: "low-stock-alert",
  reconcilePayments: "reconcile-payments",
  opsMetrics: "ops-metrics",
} as const;

const EMAIL_ATTEMPTS = 5;
const EMAIL_BACKOFF_MS = 10_000;
const KEEP_FAILED_JOBS = 1_000;
/** Failed email jobs hold reset and verify links, so they leave Redis after a day. */
export const FAILED_EMAIL_RETENTION_SECONDS = 24 * 3600;

export const EMAIL_JOB_OPTIONS = {
  attempts: EMAIL_ATTEMPTS,
  backoff: { type: "exponential", delay: EMAIL_BACKOFF_MS },
  removeOnComplete: true, // completed jobs held reset tokens; don't keep them
  removeOnFail: { age: FAILED_EMAIL_RETENTION_SECONDS, count: KEEP_FAILED_JOBS },
} as const;

export const connectionFrom = (redisUrl: string) => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
};

/**
 * Hands emails to the worker through Redis, so API responses never wait on SMTP and
 * their timing does not reveal whether an email was sent (e.g. forgot-password).
 */
export function createQueueMailer(redisUrl: string): Mailer & { close(): Promise<void> } {
  const queue = new Queue<OutgoingMail>(EMAIL_QUEUE, { connection: connectionFrom(redisUrl) });
  return {
    async send(mail) {
      await queue.add("send", mail, EMAIL_JOB_OPTIONS);
    },
    close: () => queue.close(),
  };
}

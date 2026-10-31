import nodemailer from "nodemailer";
import type { Logger } from "pino";

export type OutgoingMail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

/**
 * SMTP mailer (Mailpit locally, a real relay in production). Without SMTP_URL it
 * logs that a message was skipped — never its body, which can contain tokens.
 * Phase 2 moves sending onto the BullMQ worker.
 */
export function createSmtpMailer(
  smtpUrl: string | undefined,
  from: string,
  logger: Logger,
): Mailer {
  if (!smtpUrl) {
    return {
      async send(mail) {
        logger.warn({ to: mail.to, subject: mail.subject }, "SMTP_URL not set; email not sent");
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}

/** Test double: records messages instead of sending them. */
export function createMemoryMailer(): Mailer & { outbox: OutgoingMail[] } {
  const outbox: OutgoingMail[] = [];
  return {
    outbox,
    async send(mail) {
      outbox.push(mail);
    },
  };
}

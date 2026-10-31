import type { Request } from "express";
import { Prisma } from "@prisma/client";
import type { DbClient } from "../../lib/prisma";

/** Fields that must never be copied into the audit log. */
const SECRET_FIELDS = new Set(["passwordHash", "totpSecretEnc", "totpLastStep", "lookupTokenHash"]);

type Snapshot = Record<string, unknown> | null | undefined;

const scrub = (value: Snapshot): Prisma.InputJsonValue | typeof Prisma.DbNull => {
  if (!value) return Prisma.DbNull;
  const clean = Object.fromEntries(
    Object.entries(value).filter(([key]) => !SECRET_FIELDS.has(key)),
  );
  // Round-trip through JSON so Dates, Decimals and undefined become plain JSON.
  return JSON.parse(JSON.stringify(clean)) as Prisma.InputJsonValue;
};

export type AuditEntry = {
  /** e.g. "product.update", "order.refund" */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Snapshot;
  after?: Snapshot;
};

/**
 * Records an admin change. Call it inside the same transaction as the change, so a
 * change can't land without its audit entry (or vice versa).
 */
export async function audit(tx: DbClient, req: Request, entry: AuditEntry): Promise<void> {
  if (!req.user) throw new Error("audit() needs an authenticated request");
  await tx.auditLog.create({
    data: {
      actorId: req.user.sub,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: scrub(entry.before),
      after: scrub(entry.after),
      ip: req.ip ?? null,
    },
  });
}

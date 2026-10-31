import type { Db } from "../../lib/prisma";
import { IDEMPOTENCY_RETENTION_MS } from "../admin/idempotency";

const PURGE_BATCH = 1_000;

/**
 * Deletes expired guest carts (their items cascade) in batches until a short batch.
 * Signed-in carts are kept: they belong to an account. Carts still referenced by an unpaid
 * order are skipped in the query itself, so they can never fill a batch and block the rest.
 */
export async function purgeExpiredCarts(
  db: Db,
  now: Date = new Date(),
  batchSize: number = PURGE_BATCH,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.$executeRaw`
      DELETE FROM "Cart" WHERE id IN (
        SELECT c.id FROM "Cart" c
        WHERE c."userId" IS NULL AND c."expiresAt" < ${now}
          AND NOT EXISTS (
            SELECT 1 FROM "Order" o WHERE o."cartId" = c.id AND o."status" = 'PENDING_PAYMENT')
        ORDER BY c."expiresAt"
        LIMIT ${batchSize})`;
    total += deleted;
    if (deleted < batchSize) return total;
  }
}

/** Deletes admin Idempotency-Key records past their replay window (24 hours). */
export async function purgeIdempotencyRecords(db: Db, now: Date = new Date()): Promise<number> {
  const { count } = await db.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } },
  });
  return count;
}

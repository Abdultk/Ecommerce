import type { Mailer } from "../../lib/mailer";
import type { Db } from "../../lib/prisma";
import { lowStockEmail } from "../orders/emails";

type LowRow = { id: string; sku: string; available: number; threshold: number };

/** Clears stamps of variants that recovered (or were deactivated/archived): their next dip alerts. */
async function resetRecovered(db: Db): Promise<void> {
  await db.$executeRaw`
    UPDATE "ProductVariant" v SET "lowStockAlertedAt" = NULL
    FROM "Product" p
    WHERE p.id = v."productId" AND v."lowStockAlertedAt" IS NOT NULL
      AND NOT (v."isActive" AND p."status" <> 'ARCHIVED'
               AND v."stockOnHand" - v."stockReserved" <= v."lowStockThreshold")`;
}

/**
 * Atomically stamps unalerted low variants and returns them. A single committed UPDATE:
 * concurrent runs can't both claim a row because only NULL stamps are taken.
 */
async function claimLow(db: Db, claimedAt: Date): Promise<LowRow[]> {
  return db.$queryRaw<LowRow[]>`
    UPDATE "ProductVariant" v SET "lowStockAlertedAt" = ${claimedAt}
    FROM "Product" p
    WHERE p.id = v."productId" AND v."lowStockAlertedAt" IS NULL
      AND v."isActive" AND p."status" <> 'ARCHIVED'
      AND v."stockOnHand" - v."stockReserved" <= v."lowStockThreshold"
    RETURNING v.id, v."sku", (v."stockOnHand" - v."stockReserved")::int AS available,
              v."lowStockThreshold" AS threshold`;
}

async function recipients(db: Db, extra: readonly string[]): Promise<string[]> {
  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, disabledAt: null },
    select: { email: true },
  });
  return [...new Set([...admins.map((a) => a.email), ...extra].map((e) => e.toLowerCase()))].sort();
}

/**
 * Emails active ADMIN and SUPER_ADMIN users (plus extra recipients, e.g.
 * LOW_STOCK_ALERT_EMAIL) about variants at or below their threshold, once per dip: a
 * variant is stamped when alerted and the stamp is cleared once it recovers.
 *
 * The claim is committed before anything is sent, so no email (or queue call) runs inside
 * a transaction. In the worker the mailer enqueues one email job per recipient, which the
 * email queue retries. If handing an email over fails, the claim is released so the next
 * run alerts again. Returns how many variants were alerted.
 */
export async function sendLowStockAlerts(
  db: Db,
  mailer: Mailer,
  extraRecipients: readonly string[] = [],
): Promise<number> {
  await resetRecovered(db);
  const claimedAt = new Date();
  const low = await claimLow(db, claimedAt);
  if (low.length === 0) return 0;

  const variants = [...low].sort((a, b) => a.sku.localeCompare(b.sku));
  try {
    for (const to of await recipients(db, extraRecipients)) {
      await mailer.send(lowStockEmail(to, variants));
    }
  } catch (err) {
    await db.productVariant.updateMany({
      where: { id: { in: low.map((v) => v.id) }, lowStockAlertedAt: claimedAt },
      data: { lowStockAlertedAt: null },
    });
    throw err;
  }
  return low.length;
}

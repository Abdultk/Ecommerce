import { Prisma } from "@prisma/client";
import type { DbClient } from "../../lib/prisma";

export type LockedVariant = { id: string; stockOnHand: number; stockReserved: number };
type Line = { variantId: string; quantity: number };

/**
 * Locks variant rows for the rest of the transaction. Always in id order, so two
 * checkouts touching the same variants can't deadlock.
 */
export async function lockVariants(
  tx: DbClient,
  ids: readonly string[],
): Promise<Map<string, LockedVariant>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<LockedVariant[]>`
    SELECT id, "stockOnHand", "stockReserved" FROM "ProductVariant"
    WHERE id IN (${Prisma.join([...new Set(ids)])})
    ORDER BY id
    FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** Locks an order row; returns false if it doesn't exist. */
export async function lockOrder(tx: DbClient, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return rows.length === 1;
}

export async function reserve(tx: DbClient, lines: readonly Line[]): Promise<void> {
  for (const line of lines) {
    await tx.productVariant.update({
      where: { id: line.variantId },
      data: { stockReserved: { increment: line.quantity } },
    });
  }
}

export async function releaseReservation(tx: DbClient, lines: readonly Line[]): Promise<void> {
  await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  );
  for (const line of lines) {
    await tx.productVariant.update({
      where: { id: line.variantId },
      data: { stockReserved: { decrement: line.quantity } },
    });
  }
}

/** Turns a reservation into a sale: stock leaves the shelf and is logged against the order. */
export async function commitSale(
  tx: DbClient,
  orderId: string,
  lines: readonly Line[],
): Promise<LockedVariant[]> {
  await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  );
  const updated: LockedVariant[] = [];
  for (const line of lines) {
    const variant = await tx.productVariant.update({
      where: { id: line.variantId },
      data: {
        stockOnHand: { decrement: line.quantity },
        stockReserved: { decrement: line.quantity },
        product: { update: { salesCount: { increment: line.quantity } } },
      },
    });
    await tx.stockMovement.create({
      data: { variantId: line.variantId, delta: -line.quantity, reason: "SALE", orderId },
    });
    updated.push(variant);
  }
  return updated;
}

/** Puts sold stock back (a paid order cancelled before it shipped). */
export async function returnToStock(
  tx: DbClient,
  orderId: string,
  lines: readonly Line[],
  actorId: string | null,
): Promise<void> {
  await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  );
  for (const line of lines) {
    await tx.productVariant.update({
      where: { id: line.variantId },
      data: { stockOnHand: { increment: line.quantity } },
    });
    await tx.stockMovement.create({
      data: {
        variantId: line.variantId,
        delta: line.quantity,
        reason: "RETURN",
        note: "Order cancelled",
        orderId,
        actorId,
      },
    });
  }
}

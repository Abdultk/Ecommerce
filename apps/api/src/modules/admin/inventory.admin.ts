import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  AdminInventoryQuery,
  InventoryAdjustInput,
  Page,
  PageSize,
  ok,
  paged,
  type InventoryItem,
  type StockMovementView,
} from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { pathParam } from "../../lib/params";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/authenticate";
import { lockVariants } from "../orders/stock";
import { audit } from "./audit";
import { idempotent } from "./idempotency";

const MovementQuery = z.object({ page: Page, pageSize: PageSize });
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type InventoryRow = Omit<InventoryItem, "stockAvailable" | "lowStock">;

const toItem = (row: InventoryRow): InventoryItem => {
  const stockAvailable = Math.max(0, row.stockOnHand - row.stockReserved);
  return { ...row, stockAvailable, lowStock: stockAvailable <= row.lowStockThreshold };
};

/** Applies one ledgered stock change under the variant lock, audited in the same transaction. */
async function adjustStock(req: Request): Promise<InventoryItem> {
  const input = InventoryAdjustInput.parse(req.body);
  const variant = await prisma.$transaction(async (tx) => {
    const locked = (await lockVariants(tx, [input.variantId])).get(input.variantId);
    if (!locked) throw new AppError("NOT_FOUND", "Variant not found.");
    const next = locked.stockOnHand + input.delta;
    if (next < locked.stockReserved) {
      throw new AppError(
        "VALIDATION_ERROR",
        `That would leave ${next} on hand, but ${locked.stockReserved} are reserved by open checkouts.`,
        { minimumDelta: locked.stockReserved - locked.stockOnHand },
      );
    }
    const updated = await tx.productVariant.update({
      where: { id: input.variantId },
      data: { stockOnHand: next },
      include: { product: { select: { id: true, name: true } } },
    });
    await tx.stockMovement.create({
      data: {
        variantId: input.variantId,
        delta: input.delta,
        reason: input.reason,
        note: input.note ?? null,
        actorId: req.user!.sub,
      },
    });
    await audit(tx, req, {
      action: "inventory.adjust",
      entity: "ProductVariant",
      entityId: input.variantId,
      before: { stockOnHand: locked.stockOnHand },
      after: { stockOnHand: next, delta: input.delta, reason: input.reason },
    });
    return updated;
  });
  return toItem({
    variantId: variant.id,
    productId: variant.product.id,
    productName: variant.product.name,
    variantName: variant.name,
    sku: variant.sku,
    stockOnHand: variant.stockOnHand,
    stockReserved: variant.stockReserved,
    lowStockThreshold: variant.lowStockThreshold,
    isActive: variant.isActive,
  });
}

/** /admin/inventory: stock per variant and the adjustment ledger. */
export function inventoryAdminRouter(): Router {
  const router = Router();

  router.get("/", requirePermission("inventory:read"), async (req, res) => {
    const query = AdminInventoryQuery.parse(req.query);
    const filters: Prisma.Sql[] = [Prisma.sql`p."status" <> 'ARCHIVED'`];
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      filters.push(
        Prisma.sql`(v."sku" ILIKE ${pattern} OR p."name" ILIKE ${pattern} OR v."name" ILIKE ${pattern})`,
      );
    }
    if (query.lowStock) {
      filters.push(
        Prisma.sql`v."isActive" AND v."stockOnHand" - v."stockReserved" <= v."lowStockThreshold"`,
      );
    }
    const rows = await prisma.$queryRaw<(InventoryRow & { total: bigint })[]>`
      SELECT v.id AS "variantId", p.id AS "productId", p."name" AS "productName",
        v."name" AS "variantName", v."sku", v."stockOnHand", v."stockReserved",
        v."lowStockThreshold", v."isActive", COUNT(*) OVER () AS total
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY (v."stockOnHand" - v."stockReserved") ASC, v."sku" ASC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
    res.json(
      paged(
        rows.map(({ total: _total, ...row }) => toItem(row)),
        { page: query.page, pageSize: query.pageSize, total: Number(rows[0]?.total ?? 0) },
      ),
    );
  });

  // Every stock change lands in the ledger; on-hand can never drop below what is reserved.
  // Optional Idempotency-Key: a retried adjustment is applied once and the answer replayed.
  router.post("/adjust", requirePermission("inventory:write"), async (req, res) => {
    await idempotent(req, res, async () => ({ status: 200, body: ok(await adjustStock(req)) }));
  });

  router.get("/:variantId/movements", requirePermission("inventory:read"), async (req, res) => {
    const query = MovementQuery.parse(req.query);
    const where = { variantId: pathParam(req, "variantId") };
    const [rows, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.stockMovement.count({ where }),
    ]);
    const [orders, actors] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: rows.flatMap((r) => (r.orderId ? [r.orderId] : [])) } },
        select: { id: true, number: true },
      }),
      prisma.user.findMany({
        where: { id: { in: rows.flatMap((r) => (r.actorId ? [r.actorId] : [])) } },
        select: { id: true, email: true },
      }),
    ]);
    const numberOf = new Map(orders.map((o) => [o.id, o.number]));
    const emailOf = new Map(actors.map((a) => [a.id, a.email]));
    const items: StockMovementView[] = rows.map((m) => ({
      id: m.id,
      delta: m.delta,
      reason: m.reason,
      note: m.note,
      orderNumber: m.orderId ? (numberOf.get(m.orderId) ?? null) : null,
      actorEmail: m.actorId ? (emailOf.get(m.actorId) ?? null) : null,
      createdAt: m.createdAt.toISOString(),
    }));
    res.json(paged(items, { page: query.page, pageSize: query.pageSize, total }));
  });

  return router;
}

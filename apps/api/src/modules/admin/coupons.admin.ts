import { Router } from "express";
import type { Coupon } from "@prisma/client";
import { z } from "zod";
import { CouponInput, Page, PageSize, ok, paged, type CouponView } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/authenticate";
import { audit } from "./audit";

const CouponQuery = z.object({ page: Page, pageSize: PageSize });

export const toCouponView = (c: Coupon): CouponView => ({
  id: c.id,
  code: c.code,
  type: c.type,
  value: c.value,
  minSubtotalCents: c.minSubtotalCents,
  maxRedemptions: c.maxRedemptions,
  perCustomerLimit: c.perCustomerLimit,
  redemptions: c.redemptions,
  startsAt: c.startsAt?.toISOString() ?? null,
  endsAt: c.endsAt?.toISOString() ?? null,
  isActive: c.isActive,
  categoryIds: c.categoryIds,
  createdAt: c.createdAt.toISOString(),
});

const couponData = (input: CouponInput) => ({
  ...input,
  startsAt: input.startsAt ?? null,
  endsAt: input.endsAt ?? null,
});

/** /admin/coupons. PATCH takes the full form (the edit screen always sends every field). */
export function couponsAdminRouter(): Router {
  const router = Router();
  router.use(requirePermission("coupon:write"));

  const findCoupon = async (id: string) => {
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new AppError("NOT_FOUND", "Coupon not found.");
    return coupon;
  };

  router.get("/", async (req, res) => {
    const query = CouponQuery.parse(req.query);
    const [rows, total] = await Promise.all([
      prisma.coupon.findMany({
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.coupon.count(),
    ]);
    res.json(paged(rows.map(toCouponView), { page: query.page, pageSize: query.pageSize, total }));
  });

  router.post("/", async (req, res) => {
    const input = CouponInput.parse(req.body);
    if (await prisma.coupon.findUnique({ where: { code: input.code } })) {
      throw new AppError("CONFLICT", `The code ${input.code} already exists.`);
    }
    const coupon = await prisma.$transaction(async (tx) => {
      const created = await tx.coupon.create({ data: couponData(input) });
      await audit(tx, req, {
        action: "coupon.create",
        entity: "Coupon",
        entityId: created.id,
        after: created,
      });
      return created;
    });
    res.status(201).json(ok(toCouponView(coupon)));
  });

  router.patch("/:id", async (req, res) => {
    const input = CouponInput.parse(req.body);
    const before = await findCoupon(req.params.id);
    // The code is what customers typed on past orders, so it can't change once used.
    if (input.code !== before.code && before.redemptions > 0) {
      throw new AppError(
        "CONFLICT",
        "A code that has been used can't be renamed. Create a new one.",
      );
    }
    const coupon = await prisma.$transaction(async (tx) => {
      const updated = await tx.coupon.update({ where: { id: before.id }, data: couponData(input) });
      await audit(tx, req, {
        action: "coupon.update",
        entity: "Coupon",
        entityId: before.id,
        before,
        after: updated,
      });
      return updated;
    });
    res.json(ok(toCouponView(coupon)));
  });

  // Used codes are deactivated rather than deleted, so order history still explains discounts.
  router.delete("/:id", async (req, res) => {
    const before = await findCoupon(req.params.id);
    const used =
      before.redemptions > 0 ||
      (await prisma.order.count({ where: { couponCode: before.code } })) > 0;
    await prisma.$transaction(async (tx) => {
      if (used) await tx.coupon.update({ where: { id: before.id }, data: { isActive: false } });
      else await tx.coupon.delete({ where: { id: before.id } });
      await audit(tx, req, {
        action: used ? "coupon.deactivate" : "coupon.delete",
        entity: "Coupon",
        entityId: before.id,
        before,
      });
    });
    res.json(ok({ deleted: !used, deactivated: used }));
  });

  return router;
}

import { http } from "msw";
import {
  AdminInventoryQuery,
  CouponInput,
  InventoryAdjustInput,
  Page,
  PageSize,
  type AdminProductDetail,
  type AdminVariant,
  type CouponView,
  type InventoryItem,
} from "@hp/contracts";
import { z } from "zod";
import {
  authorize,
  errorResponse,
  invalid,
  okResponse,
  pagedResponse,
  queryOf,
  readJson,
  replaceById,
  withAudit,
  type MockContext,
} from "../http";
import type { MockMovement } from "../types";

// Mirrors apps/api/src/modules/admin/inventory.admin.ts and coupons.admin.ts.

const PageQuery = z.object({ page: Page, pageSize: PageSize });

export function toInventoryItem(p: AdminProductDetail, v: AdminVariant): InventoryItem {
  const stockAvailable = Math.max(0, v.stockOnHand - v.stockReserved);
  return {
    variantId: v.id,
    productId: p.id,
    productName: p.name,
    variantName: v.name,
    sku: v.sku,
    stockOnHand: v.stockOnHand,
    stockReserved: v.stockReserved,
    stockAvailable,
    lowStockThreshold: v.lowStockThreshold,
    lowStock: stockAvailable <= v.lowStockThreshold,
    isActive: v.isActive,
  };
}

const toCouponView = (
  input: CouponInput,
  base: Pick<CouponView, "id" | "redemptions" | "createdAt">,
): CouponView => ({
  ...base,
  code: input.code,
  type: input.type,
  value: input.value,
  minSubtotalCents: input.minSubtotalCents,
  maxRedemptions: input.maxRedemptions,
  perCustomerLimit: input.perCustomerLimit,
  startsAt: input.startsAt?.toISOString() ?? null,
  endsAt: input.endsAt?.toISOString() ?? null,
  isActive: input.isActive,
  categoryIds: input.categoryIds,
});

export function stockAndCouponRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  return [
    http.get(`${baseUrl}/admin/inventory`, ({ request }) => {
      const caller = authorize(ctx, request, "inventory:read");
      if (caller instanceof Response) return caller;
      const query = AdminInventoryQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const term = query.data.q?.toLowerCase();
      const rows = store
        .get()
        .products.filter((p) => p.status !== "ARCHIVED")
        .flatMap((p) => p.variants.map((v) => toInventoryItem(p, v)))
        .filter(
          (r) =>
            (!term ||
              [r.sku, r.productName, r.variantName].some((s) => s.toLowerCase().includes(term))) &&
            (!query.data.lowStock || (r.isActive && r.lowStock)),
        )
        .sort((a, b) => a.stockAvailable - b.stockAvailable || a.sku.localeCompare(b.sku));
      return pagedResponse(rows, query.data.page, query.data.pageSize);
    }),

    http.post(`${baseUrl}/admin/inventory/adjust`, async ({ request }) => {
      const caller = authorize(ctx, request, "inventory:write");
      if (caller instanceof Response) return caller;
      const input = InventoryAdjustInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const { variantId, delta, reason, note } = input.data;
      const product = store.get().products.find((p) => p.variants.some((v) => v.id === variantId));
      const variant = product?.variants.find((v) => v.id === variantId);
      if (!product || !variant) return errorResponse("NOT_FOUND", "Variant not found.");
      const next = variant.stockOnHand + delta;
      if (next < variant.stockReserved) {
        return errorResponse(
          "VALIDATION_ERROR",
          `That would leave ${next} on hand, but ${variant.stockReserved} are reserved by open checkouts.`,
          { minimumDelta: variant.stockReserved - variant.stockOnHand },
        );
      }
      const updatedVariant: AdminVariant = { ...variant, stockOnHand: next };
      const updatedProduct: AdminProductDetail = {
        ...product,
        variants: replaceById(product.variants, updatedVariant),
      };
      const movement: MockMovement = {
        id: ctx.nextId("mov"),
        variantId,
        delta,
        reason,
        note: note ?? null,
        orderNumber: null,
        actorEmail: caller.user.email,
        createdAt: ctx.now(),
      };
      store.update((db) =>
        withAudit(
          ctx,
          {
            ...db,
            products: replaceById(db.products, updatedProduct),
            movements: [movement, ...db.movements],
          },
          {
            actor: caller,
            action: "inventory.adjust",
            entity: "ProductVariant",
            entityId: variantId,
            before: { stockOnHand: variant.stockOnHand },
            after: { stockOnHand: next, delta, reason },
          },
        ),
      );
      return okResponse(toInventoryItem(updatedProduct, updatedVariant));
    }),

    http.get(`${baseUrl}/admin/inventory/:variantId/movements`, ({ request, params }) => {
      const caller = authorize(ctx, request, "inventory:read");
      if (caller instanceof Response) return caller;
      const query = PageQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const rows = store
        .get()
        .movements.filter((m) => m.variantId === params.variantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ variantId: _variantId, ...view }) => view);
      return pagedResponse(rows, query.data.page, query.data.pageSize);
    }),

    http.get(`${baseUrl}/admin/coupons`, ({ request }) => {
      const caller = authorize(ctx, request, "coupon:write");
      if (caller instanceof Response) return caller;
      const query = PageQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const rows = [...store.get().coupons].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return pagedResponse(rows, query.data.page, query.data.pageSize);
    }),

    http.post(`${baseUrl}/admin/coupons`, async ({ request }) => {
      const caller = authorize(ctx, request, "coupon:write");
      if (caller instanceof Response) return caller;
      const input = CouponInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      if (store.get().coupons.some((c) => c.code === input.data.code)) {
        return errorResponse("CONFLICT", `The code ${input.data.code} already exists.`);
      }
      const coupon = toCouponView(input.data, {
        id: ctx.nextId("cpn"),
        redemptions: 0,
        createdAt: ctx.now(),
      });
      store.update((db) =>
        withAudit(
          ctx,
          { ...db, coupons: [...db.coupons, coupon] },
          {
            actor: caller,
            action: "coupon.create",
            entity: "Coupon",
            entityId: coupon.id,
            before: null,
            after: coupon,
          },
        ),
      );
      return okResponse(coupon, 201);
    }),

    http.patch(`${baseUrl}/admin/coupons/:id`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "coupon:write");
      if (caller instanceof Response) return caller;
      const input = CouponInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const before = store.get().coupons.find((c) => c.id === params.id);
      if (!before) return errorResponse("NOT_FOUND", "Coupon not found.");
      if (input.data.code !== before.code && before.redemptions > 0) {
        return errorResponse(
          "CONFLICT",
          "A code that has been used can't be renamed. Create a new one.",
        );
      }
      if (store.get().coupons.some((c) => c.id !== before.id && c.code === input.data.code)) {
        return errorResponse("CONFLICT", `The code ${input.data.code} already exists.`);
      }
      const updated = toCouponView(input.data, before);
      store.update((db) =>
        withAudit(
          ctx,
          { ...db, coupons: replaceById(db.coupons, updated) },
          {
            actor: caller,
            action: "coupon.update",
            entity: "Coupon",
            entityId: before.id,
            before,
            after: updated,
          },
        ),
      );
      return okResponse(updated);
    }),

    // Used codes are deactivated rather than deleted, so order history still explains discounts.
    http.delete(`${baseUrl}/admin/coupons/:id`, ({ request, params }) => {
      const caller = authorize(ctx, request, "coupon:write");
      if (caller instanceof Response) return caller;
      const db = store.get();
      const before = db.coupons.find((c) => c.id === params.id);
      if (!before) return errorResponse("NOT_FOUND", "Coupon not found.");
      const used =
        before.redemptions > 0 || db.orders.some((o) => o.order.couponCode === before.code);
      store.update((current) =>
        withAudit(
          ctx,
          {
            ...current,
            coupons: used
              ? replaceById(current.coupons, { ...before, isActive: false })
              : current.coupons.filter((c) => c.id !== before.id),
          },
          {
            actor: caller,
            action: used ? "coupon.deactivate" : "coupon.delete",
            entity: "Coupon",
            entityId: before.id,
            before,
            after: null,
          },
        ),
      );
      return okResponse({ deleted: !used, deactivated: used });
    }),
  ];
}

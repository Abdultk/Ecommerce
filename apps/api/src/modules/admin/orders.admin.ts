import { Router } from "express";
import { safeErrorFields } from "../../lib/safe-error";
import type { Prisma } from "@prisma/client";
import {
  ADMIN_SETTABLE_STATUSES,
  AdminOrderQuery,
  CancelOrderInput,
  OrderStatusUpdate,
  ConfirmTransferInput,
  CurrencyCode,
  RefundInput,
  StoredAddress,
  can,
  canRefund,
  canTransition,
  PaymentProvider,
  ok,
  paged,
  type AdminOrderDetail,
  type AdminOrderListItem,
} from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { pathParam } from "../../lib/params";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/authenticate";
import { wantsShippingEmail } from "../account/preferences";
import { orderDeliveredEmail, orderShippedEmail } from "../orders/emails";
import {
  ORDER_DETAIL_INCLUDE,
  paymentDueAt,
  paymentLabelOf,
  toOrderDetail,
  toPaymentMethod,
  toPaymentMethodRow,
} from "../orders/order-view";
import {
  ADMIN_CANCELLABLE,
  type AuditInTx,
  cancelOrder,
  refundOrder,
  type OrderDeps,
} from "../orders/orders.service";
import { confirmTransfer } from "../orders/confirm-transfer";
import { lockOrder } from "../orders/stock";
import { audit } from "./audit";
import { idempotent } from "./idempotency";

const DAY_MS = 86_400_000;
const isMidnightUtc = (d: Date) => d.getTime() % DAY_MS === 0;

function listWhere(query: ReturnType<typeof AdminOrderQuery.parse>): Prisma.OrderWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from) createdAt.gte = query.from;
  // A plain date as the end means "through the end of that day".
  if (query.to) {
    createdAt.lt = isMidnightUtc(query.to) ? new Date(query.to.getTime() + DAY_MS) : query.to;
  }
  return {
    ...(query.status && { status: query.status }),
    ...(query.paymentMethod && { paymentMethod: toPaymentMethodRow(query.paymentMethod) }),
    ...((query.from || query.to) && { createdAt }),
    ...(query.q && {
      OR: [
        { number: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
      ],
    }),
  };
}

const customerName = (o: {
  shippingAddress: Prisma.JsonValue;
  user: { firstName: string; lastName: string } | null;
}) => {
  if (o.user) return `${o.user.firstName} ${o.user.lastName}`;
  const address = StoredAddress.safeParse(o.shippingAddress);
  return address.success ? address.data.fullName : null;
};

async function adminOrderDetail(id: string): Promise<AdminOrderDetail> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { ...ORDER_DETAIL_INCLUDE, user: true, refunds: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const actors = await prisma.user.findMany({
    where: {
      id: {
        in: [
          ...order.refunds.map((r) => r.actorId),
          ...(order.transferConfirmedById ? [order.transferConfirmedById] : []),
        ],
      },
    },
    select: { id: true, email: true },
  });
  const emailOf = new Map(actors.map((a) => [a.id, a.email]));
  return {
    order: toOrderDetail(order),
    customer: order.user
      ? {
          id: order.user.id,
          email: order.user.email,
          name: `${order.user.firstName} ${order.user.lastName}`,
        }
      : null,
    paymentIntentId: order.providerPaymentId,
    paymentProvider: PaymentProvider.safeParse(order.paymentProvider).data ?? null,
    transferBankReference: order.transferBankReference,
    transferConfirmedByEmail: order.transferConfirmedById
      ? (emailOf.get(order.transferConfirmedById) ?? null)
      : null,
    refunds: order.refunds.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      reason: r.reason,
      actorEmail: emailOf.get(r.actorId) ?? null,
      createdAt: r.createdAt.toISOString(),
      provider: PaymentProvider.catch("manual").parse(r.provider),
      bankReference: r.bankReference,
    })),
    allowedStatuses: ADMIN_SETTABLE_STATUSES.filter((s) => canTransition(order.status, s)),
    canCancel: ADMIN_CANCELLABLE.includes(order.status),
    refundableCents: canRefund(order.status) ? order.totalCents - order.refundedCents : 0,
  };
}

async function findOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  return order;
}

/** /admin/orders */
export function ordersAdminRouter(deps: OrderDeps): Router {
  const router = Router();

  router.get("/", requirePermission("order:read"), async (req, res) => {
    const query = AdminOrderQuery.parse(req.query);
    const where = listWhere(query);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { select: { quantity: true } },
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.order.count({ where }),
    ]);
    const items: AdminOrderListItem[] = orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      email: o.email,
      customerName: customerName(o),
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      totalCents: o.totalCents,
      refundedCents: o.refundedCents,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      currency: CurrencyCode.parse(o.currency),
      paymentMethod: toPaymentMethod(o.paymentMethod),
      paymentLabel: paymentLabelOf(o),
      paymentDueAt: paymentDueAt(o),
    }));
    res.json(paged(items, { page: query.page, pageSize: query.pageSize, total }));
  });

  router.get("/:id", requirePermission("order:read"), async (req, res) => {
    res.json(ok(await adminOrderDetail(pathParam(req, "id"))));
  });

  // Fulfilment steps only: PAID comes from the payment webhook; cancel and refund have routes.
  router.patch("/:id/status", requirePermission("order:write"), async (req, res) => {
    const input = OrderStatusUpdate.parse(req.body);
    const shipped = await prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, pathParam(req, "id"))))
        throw new AppError("NOT_FOUND", "Order not found.");
      const order = await tx.order.findUniqueOrThrow({ where: { id: pathParam(req, "id") } });
      if (!canTransition(order.status, input.status)) {
        throw new AppError(
          "CONFLICT",
          `An order that is ${order.status} can't be marked ${input.status}.`,
        );
      }
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: input.status,
          ...(input.trackingNumber && { trackingNumber: input.trackingNumber }),
          ...(input.carrier && { carrier: input.carrier }),
          // Noon UTC keeps the calendar day stable in every timezone the shop and customer use.
          ...(input.expectedDeliveryDate && {
            estimatedDeliveryAt: new Date(`${input.expectedDeliveryDate}T12:00:00Z`),
          }),
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "status_changed",
          fromStatus: order.status,
          toStatus: input.status,
          message: input.note ?? null,
          actorId: req.user!.sub,
        },
      });
      await audit(tx, req, {
        action: "order.status",
        entity: "Order",
        entityId: order.id,
        before: { status: order.status, trackingNumber: order.trackingNumber },
        after: { status: updated.status, trackingNumber: updated.trackingNumber },
      });
      return input.status === "SHIPPED" || input.status === "DELIVERED" ? updated : null;
    });
    // Receipts and payment emails are never optional; shipping updates follow the customer's choice.
    if (shipped && (await wantsShippingEmail(prisma, shipped.userId))) {
      const mail =
        shipped.status === "DELIVERED" ? orderDeliveredEmail(shipped) : orderShippedEmail(shipped);
      await deps.mailer.send(mail).catch((err: unknown) => {
        logger.error(
          { err: safeErrorFields(err), orderId: shipped.id },
          "could not send shipping update email",
        );
      });
    }
    res.json(ok(await adminOrderDetail(pathParam(req, "id"))));
  });

  // Cancel and refund call the payment provider outside the transaction, but each audit
  // entry is written inside the transaction that changes the order. Both honour an optional
  // Idempotency-Key, so a retry after a dropped response doesn't cancel or refund twice.
  router.post("/:id/cancel", requirePermission("order:write"), async (req, res) => {
    await idempotent(req, res, async ({ providerKey }) => {
      const input = CancelOrderInput.parse(req.body ?? {});
      const id = (await findOrder(pathParam(req, "id"))).id;
      await cancelOrder(deps, id, {
        allowed: ADMIN_CANCELLABLE,
        actorId: req.user!.sub,
        reason: input.reason,
        mayRefund: can(req.user!.role, "order:refund"),
        providerKey,
        audit: (tx, before) =>
          audit(tx, req, {
            action: "order.cancel",
            entity: "Order",
            entityId: id,
            before: { status: before.status, refundedCents: before.refundedCents },
            after: { status: "CANCELLED", reason: input.reason ?? null },
          }),
      });
      return { status: 200, body: ok(await adminOrderDetail(id)) };
    });
  });

  router.post("/:id/refund", requirePermission("order:refund"), async (req, res) => {
    await idempotent(req, res, async ({ providerKey }) => {
      const input = RefundInput.parse(req.body);
      const id = (await findOrder(pathParam(req, "id"))).id;
      const auditRefund: AuditInTx = (tx, before) =>
        audit(tx, req, {
          action: "order.refund",
          entity: "Order",
          entityId: id,
          before: { refundedCents: before.refundedCents, status: before.status },
          after: {
            refundedCents: before.refundedCents + input.amountCents,
            reason: input.reason ?? null,
            bankReference: input.bankReference ?? null,
          },
        });
      await refundOrder(deps, id, input, req.user!.sub, { audit: auditRefund, providerKey });
      return { status: 200, body: ok(await adminOrderDetail(id)) };
    });
  });

  // A customer's bank transfer arrived. The Idempotency-Key is required: a retried click
  // must never confirm (or email) twice.
  router.post(
    "/:id/confirm-transfer",
    requirePermission("order:confirm-payment"),
    async (req, res) => {
      if (req.header("Idempotency-Key") === undefined) {
        throw new AppError("VALIDATION_ERROR", "An Idempotency-Key header is required.");
      }
      await idempotent(req, res, async () => {
        const input = ConfirmTransferInput.parse(req.body);
        const id = (await findOrder(pathParam(req, "id"))).id;
        await confirmTransfer(deps, id, input, req.user!.sub, (tx, before) =>
          audit(tx, req, {
            action: "order.confirm_transfer",
            entity: "Order",
            entityId: id,
            before: { status: before.status },
            after: {
              status: "PAID",
              receivedCents: input.receivedCents,
              bankReference: input.bankReference,
            },
          }),
        );
        return { status: 200, body: ok(await adminOrderDetail(id)) };
      });
    },
  );

  return router;
}

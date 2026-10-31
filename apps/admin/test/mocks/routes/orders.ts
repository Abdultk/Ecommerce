import { http } from "msw";
import {
  ADMIN_SETTABLE_STATUSES,
  AdminOrderQuery,
  CancelOrderInput,
  ConfirmTransferInput,
  OrderStatusUpdate,
  RefundInput,
  canRefund,
  canTransition,
  refundStateFor,
  type AdminOrderDetail,
  type AdminOrderListItem,
  type OrderEvent,
  type OrderStatus,
} from "@hp/contracts";
import type { z } from "zod";
import {
  authorize,
  errorResponse,
  invalid,
  okResponse,
  pagedResponse,
  queryOf,
  readJson,
  withAudit,
  type MockContext,
} from "../http";
import type { MockDb, MockOrder, MockUser } from "../types";

// Mirrors apps/api/src/modules/admin/orders.admin.ts.

const DAY_MS = 86_400_000;
const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** Same as the API's ADMIN_CANCELLABLE. */
const ADMIN_CANCELLABLE: readonly OrderStatus[] = ["PENDING_PAYMENT", "PAID", "PROCESSING"];

export function toOrderDetailView(o: MockOrder, users: readonly MockUser[]): AdminOrderDetail {
  const customer = users.find((u) => u.user.id === o.customerId);
  const { status, totalCents, refundedCents } = o.order;
  return {
    order: o.order,
    customer: customer
      ? {
          id: customer.user.id,
          email: customer.user.email,
          name: `${customer.user.firstName} ${customer.user.lastName}`,
        }
      : null,
    paymentIntentId: o.paymentIntentId,
    paymentProvider: o.paymentProvider,
    transferBankReference: o.transferBankReference,
    transferConfirmedByEmail: o.transferConfirmedByEmail,
    refunds: o.refunds,
    allowedStatuses: ADMIN_SETTABLE_STATUSES.filter((s) => canTransition(status, s)),
    canCancel: ADMIN_CANCELLABLE.includes(status),
    refundableCents: canRefund(status) ? totalCents - refundedCents : 0,
  };
}

export function toOrderListItem(o: MockOrder, users: readonly MockUser[]): AdminOrderListItem {
  const customer = users.find((u) => u.user.id === o.customerId);
  return {
    id: o.order.id,
    number: o.order.number,
    status: o.order.status,
    email: o.order.email,
    customerName: customer
      ? `${customer.user.firstName} ${customer.user.lastName}`
      : o.order.shippingAddress.fullName,
    itemCount: o.order.itemCount,
    totalCents: o.order.totalCents,
    refundedCents: o.order.refundedCents,
    createdAt: o.order.createdAt,
    paidAt: o.order.paidAt,
    currency: o.order.currency,
    paymentMethod: o.order.paymentMethod,
    paymentLabel: o.order.paymentLabel,
    paymentDueAt: o.order.paymentDueAt,
  };
}

function matches(o: MockOrder, q: z.infer<typeof AdminOrderQuery>): boolean {
  const created = Date.parse(o.order.createdAt);
  const term = q.q?.toLowerCase();
  // A plain date as the end means "through the end of that day".
  const end = q.to && (q.to.getTime() % DAY_MS === 0 ? q.to.getTime() + DAY_MS : q.to.getTime());
  return (
    (!q.status || o.order.status === q.status) &&
    (!q.paymentMethod || o.order.paymentMethod === q.paymentMethod) &&
    (!term ||
      o.order.number.toLowerCase().includes(term) ||
      o.order.email.toLowerCase().includes(term)) &&
    (!q.from || created >= q.from.getTime()) &&
    (!end || created < end)
  );
}

/** The API's refusal for a transfer confirmation, or null when it may proceed. */
function transferRefusal(o: MockOrder, receivedCents: number): Response | null {
  if (o.order.paymentMethod !== "bank_transfer" || o.order.status !== "PENDING_PAYMENT") {
    return errorResponse(
      "CONFLICT",
      "Only bank-transfer orders awaiting payment can be confirmed. An expired order was cancelled.",
    );
  }
  if (receivedCents !== o.order.totalCents) {
    return errorResponse(
      "AMOUNT_MISMATCH",
      "The amount received doesn't match the order total. Contact the customer before confirming.",
      { expectedCents: o.order.totalCents, receivedCents },
    );
  }
  return null;
}

export function orderRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  const event = (
    order: MockOrder,
    type: string,
    toStatus: OrderStatus | null,
    message: string | null,
  ): OrderEvent => ({
    id: ctx.nextId("ev"),
    type,
    fromStatus: toStatus ? order.order.status : null,
    toStatus,
    message,
    createdAt: ctx.now(),
  });

  /** Saves the changed order with an audit entry and answers with its detail view. */
  const save = (caller: MockUser, before: MockOrder, after: MockOrder, action: string) => {
    const db = store.update((current: MockDb) =>
      withAudit(
        ctx,
        {
          ...current,
          orders: current.orders.map((o) => (o.order.id === after.order.id ? after : o)),
        },
        {
          actor: caller,
          action,
          entity: "Order",
          entityId: after.order.id,
          before: { status: before.order.status, refundedCents: before.order.refundedCents },
          after: { status: after.order.status, refundedCents: after.order.refundedCents },
        },
      ),
    );
    return okResponse(toOrderDetailView(after, db.users));
  };

  const withRefund = (
    o: MockOrder,
    caller: MockUser,
    amountCents: number,
    reason: string | null,
    bankReference: string | null = null,
  ) => {
    const refundedCents = o.order.refundedCents + amountCents;
    const refundState = refundStateFor(o.order.totalCents, refundedCents);
    // Transfer orders are refunded by hand from the bank; card refunds go to the provider.
    const provider =
      o.order.paymentMethod === "bank_transfer" ? "manual" : (o.paymentProvider ?? "amwal");
    return {
      order: { ...o.order, refundedCents, refundState },
      refund: {
        id: ctx.nextId("refund"),
        amountCents,
        reason,
        actorEmail: caller.user.email,
        createdAt: ctx.now(),
        provider,
        bankReference,
      },
    };
  };

  const find = (id: unknown) => store.get().orders.find((o) => o.order.id === id);

  return [
    http.get(`${baseUrl}/admin/orders`, ({ request }) => {
      const caller = authorize(ctx, request, "order:read");
      if (caller instanceof Response) return caller;
      const query = AdminOrderQuery.safeParse(queryOf(request));
      if (!query.success) return invalid(query.error);
      const db = store.get();
      const rows = db.orders
        .filter((o) => matches(o, query.data))
        .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt))
        .map((o) => toOrderListItem(o, db.users));
      return pagedResponse(rows, query.data.page, query.data.pageSize);
    }),

    http.get(`${baseUrl}/admin/orders/:id`, ({ request, params }) => {
      const caller = authorize(ctx, request, "order:read");
      if (caller instanceof Response) return caller;
      const found = find(params.id);
      if (!found) return errorResponse("NOT_FOUND", "Order not found.");
      return okResponse(toOrderDetailView(found, store.get().users));
    }),

    http.patch(`${baseUrl}/admin/orders/:id/status`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "order:write");
      if (caller instanceof Response) return caller;
      const input = OrderStatusUpdate.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const before = find(params.id);
      if (!before) return errorResponse("NOT_FOUND", "Order not found.");
      const { status, trackingNumber, carrier, expectedDeliveryDate, note } = input.data;
      if (!canTransition(before.order.status, status)) {
        return errorResponse(
          "CONFLICT",
          `An order that is ${before.order.status} can't be marked ${status}.`,
        );
      }
      const after: MockOrder = {
        ...before,
        order: {
          ...before.order,
          status,
          trackingNumber: trackingNumber ?? before.order.trackingNumber,
          carrier: carrier ?? before.order.carrier,
          estimatedDeliveryAt: expectedDeliveryDate
            ? `${expectedDeliveryDate}T12:00:00.000Z`
            : before.order.estimatedDeliveryAt,
          events: [...before.order.events, event(before, "status_changed", status, note ?? null)],
        },
      };
      return save(caller, before, after, "order.status");
    }),

    http.post(`${baseUrl}/admin/orders/:id/cancel`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "order:write");
      if (caller instanceof Response) return caller;
      const input = CancelOrderInput.safeParse((await readJson(request)) ?? {});
      if (!input.success) return invalid(input.error);
      const before = find(params.id);
      if (!before) return errorResponse("NOT_FOUND", "Order not found.");
      if (!ADMIN_CANCELLABLE.includes(before.order.status)) {
        return errorResponse("CONFLICT", "This order can no longer be cancelled.");
      }
      const reason = input.data.reason ?? null;
      // A paid order has its remaining balance refunded as part of the cancellation.
      const remaining = before.order.totalCents - before.order.refundedCents;
      const refunded =
        before.order.paidAt && remaining > 0 ? withRefund(before, caller, remaining, reason) : null;
      const after: MockOrder = {
        ...before,
        refunds: refunded ? [...before.refunds, refunded.refund] : before.refunds,
        order: {
          ...(refunded?.order ?? before.order),
          status: "CANCELLED",
          // A cancelled transfer order no longer awaits payment.
          paymentDueAt: null,
          bankTransfer: null,
          events: [...before.order.events, event(before, "cancelled", "CANCELLED", reason)],
        },
      };
      return save(caller, before, after, "order.cancel");
    }),

    http.post(`${baseUrl}/admin/orders/:id/refund`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "order:refund");
      if (caller instanceof Response) return caller;
      const input = RefundInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const before = find(params.id);
      if (!before) return errorResponse("NOT_FOUND", "Order not found.");
      if (!canRefund(before.order.status) || !before.paymentProvider) {
        return errorResponse("CONFLICT", "This order can't be refunded.");
      }
      const bankReference = input.data.bankReference ?? null;
      if (before.order.paymentMethod === "bank_transfer" && !bankReference) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Enter the bank reference of the refund transfer.",
          { bankReference: ["Enter the bank reference."] },
        );
      }
      const refundable = before.order.totalCents - before.order.refundedCents;
      if (input.data.amountCents > refundable) {
        return errorResponse("VALIDATION_ERROR", `At most ${refundable} cents can be refunded.`, {
          refundableCents: refundable,
        });
      }
      const { order, refund } = withRefund(
        before,
        caller,
        input.data.amountCents,
        input.data.reason ?? null,
        bankReference,
      );
      const full = order.refundState === "FULL";
      const after: MockOrder = {
        ...before,
        refunds: [...before.refunds, refund],
        order: {
          ...order,
          status: full ? "REFUNDED" : order.status,
          events: [
            ...before.order.events,
            event(before, "refunded", full ? "REFUNDED" : null, input.data.reason ?? null),
          ],
        },
      };
      return save(caller, before, after, "order.refund");
    }),

    http.post(`${baseUrl}/admin/orders/:id/confirm-transfer`, async ({ request, params }) => {
      const caller = authorize(ctx, request, "order:confirm-payment");
      if (caller instanceof Response) return caller;
      const key = request.headers.get(IDEMPOTENCY_HEADER);
      if (!key) return errorResponse("VALIDATION_ERROR", "An Idempotency-Key header is required.");
      const input = ConfirmTransferInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const before = find(params.id);
      if (!before) return errorResponse("NOT_FOUND", "Order not found.");
      // A retry with the same key replays the first result instead of failing.
      if (before.transferConfirmKey === key) {
        return okResponse(toOrderDetailView(before, store.get().users));
      }
      const refusal = transferRefusal(before, input.data.receivedCents);
      if (refusal) return refusal;
      const after = confirmedTransfer(before, caller, input.data, key);
      return save(caller, before, after, "order.confirm_transfer");
    }),
  ];

  function confirmedTransfer(
    before: MockOrder,
    caller: MockUser,
    input: ConfirmTransferInput,
    key: string,
  ): MockOrder {
    const note = input.note ?? null;
    return {
      ...before,
      paymentProvider: "manual",
      transferBankReference: input.bankReference,
      transferConfirmedByEmail: caller.user.email,
      transferConfirmKey: key,
      order: {
        ...before.order,
        status: "PAID",
        paidAt: ctx.now(),
        paymentDueAt: null,
        bankTransfer: null,
        events: [
          ...before.order.events,
          event(before, "transfer_confirmed", "PAID", note ?? `Bank ref ${input.bankReference}`),
        ],
      },
    };
  }
}

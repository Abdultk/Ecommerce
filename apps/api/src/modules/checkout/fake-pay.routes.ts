import express, { Router } from "express";
import { z } from "zod";
import { OrderNumber, formatMoney, ok } from "@hp/contracts";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import type { FakeGateway } from "../../lib/payments";
import { ORDER_DETAIL_INCLUDE, toOrderDetail } from "../orders/order-view";
import { handlePaymentEvent } from "../payments/payment-events";
import type { OrderDeps } from "../orders/orders.service";
import { currencyOf } from "../settings/settings.service";

const Outcome = z.object({ outcome: z.enum(["paid", "failed"]) });
const FakeConfirmInput = z.object({ orderNumber: OrderNumber });
const SessionId = z.string().regex(/^fs_[a-f0-9]{32}$/);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.6rem 1rem;margin-right:.5rem}</style></head><body>${body}</body></html>`;
}

/**
 * Development-only stand-in for a hosted card page (Amwal Pay). Mounted only when the fake
 * provider is active outside production, so these paths are 404 in production. Paying here
 * only marks the fake provider's session paid: the order itself becomes PAID the same way it
 * does for real, through the server-side status check (never the redirect).
 */
export function fakePayRouter(deps: OrderDeps & { payments: FakeGateway }): Router {
  const router = Router();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${env.WEB_ORIGIN}`;

  const sessionOr404 = (raw: string) => {
    const payment = SessionId.safeParse(raw).success ? deps.payments.bySession(raw) : undefined;
    if (!payment) throw new AppError("NOT_FOUND", "Payment session not found.");
    return payment;
  };

  router.get("/fake-pay/:sessionId", async (req, res) => {
    const payment = sessionOr404(req.params.sessionId);
    const order = await deps.db.order.findUnique({ where: { number: payment.orderNumber } });
    const amount = order
      ? formatMoney(payment.amountCents, currencyOf(order))
      : String(payment.amountCents);
    res.setHeader("Content-Security-Policy", csp);
    res
      .type("html")
      .send(
        page(
          "Test payment",
          `<h1>Test payment (development only)</h1><p>Order ${escapeHtml(payment.orderNumber)}: <strong>${escapeHtml(amount)}</strong></p><form method="post"><button name="outcome" value="paid">Pay</button><button name="outcome" value="failed">Decline</button></form>`,
        ),
      );
  });

  router.post("/fake-pay/:sessionId", express.urlencoded({ extended: false }), (req, res) => {
    const payment = sessionOr404(req.params.sessionId);
    const { outcome } = Outcome.parse(req.body);
    if (outcome === "paid") deps.payments.markSucceeded(payment.id);
    else deps.payments.markFailed(payment.id);
    res.setHeader("Content-Security-Policy", csp);
    res.redirect(303, outcome === "paid" ? payment.returnUrl : `${payment.returnUrl}&cancelled=1`);
  });

  // Tests and the e2e suite: completes a card payment as if the provider had confirmed it.
  router.post("/fake-confirm", async (req, res) => {
    const { orderNumber } = FakeConfirmInput.parse(req.body);
    const order = await deps.db.order.findUnique({ where: { number: orderNumber } });
    if (!order?.providerPaymentId) throw new AppError("NOT_FOUND", "Order not found.");
    deps.payments.markSucceeded(order.providerPaymentId);
    await handlePaymentEvent(deps, {
      id: `fake-confirm:${order.providerPaymentId}`,
      type: "check_payment",
      ref: { paymentId: order.providerPaymentId, sessionId: order.providerSessionId },
    });
    const paid = await deps.db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: ORDER_DETAIL_INCLUDE,
    });
    res.json(ok(toOrderDetail(paid)));
  });

  return router;
}

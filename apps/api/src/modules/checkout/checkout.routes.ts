import { Router } from "express";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { z } from "zod";
import {
  CheckoutInput,
  CheckoutStatusInput,
  ShippingQuoteInput,
  ok,
  type CheckoutStatus,
} from "@hp/contracts";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { AmwalGateway, FakeGateway } from "../../lib/payments";
import { rateLimit } from "../../lib/rate-limit";
import { safeErrorFields } from "../../lib/safe-error";
import { optionalAuth } from "../../middleware/authenticate";
import { lookupTokenMatches } from "../orders/lookup-token";
import { paymentRefOf, type OrderDeps } from "../orders/orders.service";
import { handlePaymentEvent } from "../payments/payment-events";
import { createCheckoutIntent, quoteShipping, type CheckoutDeps } from "./checkout.service";
import { amwalPayRouter } from "./amwal-pay.routes";
import { fakePayRouter } from "./fake-pay.routes";

const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Invalid Idempotency-Key.");
const NOT_FOUND = "We couldn't find that order.";

/**
 * Asks the provider about a pending card order and books the payment if it went through
 * (same path as the webhook). Provider trouble is logged; the caller just sees "pending".
 */
async function confirmWithProvider(deps: OrderDeps, order: Parameters<typeof paymentRefOf>[0]) {
  const ref = paymentRefOf(order);
  if (!ref) return;
  try {
    await handlePaymentEvent(deps, {
      id: `status:${ref.sessionId ?? ref.paymentId}`,
      type: "check_payment",
      ref,
    });
  } catch (err) {
    logger.warn({ err: safeErrorFields(err) }, "checkout status check failed");
  }
}

export function checkoutRouter(
  deps: CheckoutDeps & { checkoutLimiter: RateLimiterAbstract; statusLimiter: RateLimiterAbstract },
): Router {
  const router = Router();
  router.use(optionalAuth);

  router.post("/shipping-quote", async (req, res) => {
    ShippingQuoteInput.parse(req.body); // Oman address check; rates don't vary by governorate yet
    res.json(ok(await quoteShipping(deps.db, req)));
  });

  // Each checkout holds stock for a while, so it is limited per IP to stop stock being tied up.
  router.post("/intent", rateLimit(deps.checkoutLimiter), async (req, res) => {
    const input = CheckoutInput.parse(req.body);
    const key = req.header("Idempotency-Key");
    const intent = await createCheckoutIntent(
      deps,
      req,
      input,
      key === undefined ? undefined : IdempotencyKey.parse(key),
    );
    res.status(201).json(ok(intent));
  });

  // Polled by /checkout/return. Never trusts the redirect: a pending card order is checked
  // with the provider server-side. Signed-in owners need no token; guests send theirs.
  router.post("/status", rateLimit(deps.statusLimiter), async (req, res) => {
    const input = CheckoutStatusInput.parse(req.body);
    const order = await deps.db.order.findUnique({ where: { number: input.number } });
    const owner = order?.userId != null && order.userId === req.user?.sub;
    const guest = order && input.token !== undefined && lookupTokenMatches(input.token, order);
    if (!order || !(owner || guest)) throw new AppError("NOT_FOUND", NOT_FOUND);
    if (order.status === "PENDING_PAYMENT" && order.paymentMethod === "CARD") {
      await confirmWithProvider(deps, order);
    }
    const current = await deps.db.order.findUniqueOrThrow({ where: { id: order.id } });
    const body: CheckoutStatus = { status: current.status };
    res.json(ok(body));
  });

  // Local development and tests only: a stand-in for the hosted card page.
  if (deps.payments.provider === "fake" && env.NODE_ENV !== "production") {
    router.use(fakePayRouter({ ...deps, payments: deps.payments as FakeGateway }));
  }
  // Amwal Pay: the page that opens SmartBox for an order waiting for payment.
  if (deps.payments.provider === "amwal") {
    router.use(amwalPayRouter({ ...deps, payments: deps.payments as AmwalGateway }));
  }
  return router;
}

import express, { Router, type Request, type Response } from "express";
import { ok } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { WebhookSignatureError, type PaymentEvent } from "../../lib/payments";
import { safeErrorFields } from "../../lib/safe-error";
import type { OrderDeps } from "../orders/orders.service";
import { handlePaymentEvent } from "./payment-events";

const MAX_WEBHOOK_BYTES = "1mb";

type Outcome =
  "processed" | "duplicate" | "ignored" | "invalid_signature" | "invalid_payload" | "error";

/** One line per webhook request: outcome and event type only, never the payload. */
function logWebhook(provider: string, outcome: Outcome, event: PaymentEvent | null, err?: unknown) {
  const line = {
    event: "payments.webhook",
    provider,
    outcome,
    type: event?.type ?? null,
    eventId: event?.id ?? null,
  };
  if (outcome === "processed" || outcome === "duplicate" || outcome === "ignored") {
    logger.info(line, "payments.webhook");
  } else if (outcome === "error") {
    logger.error({ ...line, err: safeErrorFields(err) }, "payments.webhook");
  } else {
    logger.warn(line, "payments.webhook");
  }
}

function verify(deps: OrderDeps, req: Request, provider: string): PaymentEvent {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body)) throw new AppError("VALIDATION_ERROR", "Expected a JSON body.");
  try {
    return deps.payments.parseWebhook(body, (name) => req.header(name));
  } catch (err) {
    const badSignature = err instanceof WebhookSignatureError;
    logWebhook(provider, badSignature ? "invalid_signature" : "invalid_payload", null);
    throw new AppError(
      "VALIDATION_ERROR",
      badSignature ? "Invalid signature." : "Invalid payload.",
    );
  }
}

const receive = (deps: OrderDeps, provider: string) => async (req: Request, res: Response) => {
  const event = verify(deps, req, provider);
  let duplicate: boolean;
  try {
    ({ duplicate } = await handlePaymentEvent(deps, event));
  } catch (err) {
    logWebhook(provider, "error", event, err);
    throw err;
  }
  logWebhook(
    provider,
    duplicate ? "duplicate" : event.type === "ignored" ? "ignored" : "processed",
    event,
  );
  res.json(ok(duplicate ? { received: true, duplicate: true } : { received: true }));
};

/**
 * Provider webhooks. Mounted before express.json(): signature verification needs the
 * exact raw bytes. Not rate limited per IP (providers send from a few addresses); the
 * signature is the gate. Each path verifies with the configured gateway, so a request
 * signed for another provider fails verification.
 */
export function webhookRouter(deps: OrderDeps): Router {
  const router = Router();
  const raw = express.raw({ type: "application/json", limit: MAX_WEBHOOK_BYTES });
  router.post("/stripe", raw, receive(deps, "stripe"));
  // Amwal's "merchant cloud notification" URL, set in the Amwal Pay portal.
  router.post("/amwal", raw, receive(deps, "amwal"));
  return router;
}

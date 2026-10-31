import { randomUUID } from "node:crypto";
import {
  PaymentProviderError,
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentRef,
} from "./types";

export const FAKE_SIGNATURE = "fake-signature";
const SIGNATURE_HEADERS = ["stripe-signature", "x-fake-signature"];

type FakePayment = {
  id: string;
  sessionId: string;
  orderNumber: string;
  returnUrl: string;
  amountCents: number;
  refundedCents: number;
  cancelled: boolean;
  succeeded: boolean;
  failed: boolean;
};

export type FakeGateway = PaymentGateway & {
  /** Keyed by payment id. */
  intents: ReadonlyMap<string, FakePayment>;
  /** The payment behind a hosted-page session (the dev fake-pay page uses this). */
  bySession(sessionId: string): FakePayment | undefined;
  /** Simulates the customer completing payment at the provider (no webhook is sent). */
  markSucceeded(paymentIdOrSession: string): void;
  /** Simulates a declined card. */
  markFailed(paymentIdOrSession: string): void;
  /** Raw webhook body for a successful payment (send with header stripe-signature: fake-signature). */
  succeededEvent(paymentId: string, amountCents: number): PaymentEvent;
};

const ref = (p: FakePayment): PaymentRef => ({ paymentId: p.id, sessionId: p.sessionId });

/**
 * In-memory hosted checkout: never contacts a provider. The redirect goes to the API's
 * dev-only fake-pay page (404 in production; env validation refuses "fake" there anyway).
 */
export function createFakeGateway(
  payPageBase = "http://localhost:4000/api/v1/checkout/fake-pay",
): FakeGateway {
  const payments = new Map<string, FakePayment>();
  const sessions = new Map<string, string>();
  const byIdempotencyKey = new Map<string, string>();
  const refundsByKey = new Map<string, string>();

  const find = (key: string | null | undefined): FakePayment => {
    const id = key ? (payments.has(key) ? key : sessions.get(key)) : undefined;
    const payment = id ? payments.get(id) : undefined;
    if (!payment) throw new PaymentProviderError(`Unknown fake payment ${key ?? "(none)"}`);
    return payment;
  };
  const findRef = (r: PaymentRef) => find(r.paymentId ?? r.sessionId);
  const update = (p: FakePayment, patch: Partial<FakePayment>) =>
    payments.set(p.id, { ...p, ...patch });
  const redirect = (p: FakePayment) => ({
    kind: "redirect" as const,
    provider: "fake" as const,
    redirectUrl: `${payPageBase}/${p.sessionId}`,
  });

  return {
    provider: "fake",
    intents: payments,
    supports: () => true,
    async createPayment(input) {
      const known = byIdempotencyKey.get(input.idempotencyKey);
      if (known) {
        const existing = find(known);
        return { ref: ref(existing), payment: redirect(existing) };
      }
      const payment: FakePayment = {
        id: `pi_fake_${randomUUID().replace(/-/g, "")}`,
        sessionId: `fs_${randomUUID().replace(/-/g, "")}`,
        orderNumber: input.orderNumber,
        returnUrl: input.returnUrl,
        amountCents: input.amountCents,
        refundedCents: 0,
        cancelled: false,
        succeeded: false,
        failed: false,
      };
      payments.set(payment.id, payment);
      sessions.set(payment.sessionId, payment.id);
      byIdempotencyKey.set(input.idempotencyKey, payment.id);
      return { ref: ref(payment), payment: redirect(payment) };
    },
    async resumePayment(r) {
      return redirect(findRef(r));
    },
    async cancelPayment(r) {
      update(findRef(r), { cancelled: true });
    },
    async getPaymentStatus(r) {
      const p = findRef(r);
      if (p.succeeded) return { status: "succeeded", amountCents: p.amountCents, paymentId: p.id };
      const status = p.cancelled ? "canceled" : "requires_payment";
      return { status, amountCents: 0, paymentId: p.id };
    },
    bySession: (sessionId) => {
      const id = sessions.get(sessionId);
      return id ? payments.get(id) : undefined;
    },
    markSucceeded(key) {
      update(find(key), { succeeded: true, failed: false });
    },
    markFailed(key) {
      update(find(key), { failed: true });
    },
    async refund({ paymentId, amountCents, idempotencyKey }) {
      // Like Stripe: a repeated idempotency key returns the original refund, not a new one.
      const known = refundsByKey.get(idempotencyKey);
      if (known) return { id: known };
      const p = find(paymentId);
      if (p.refundedCents + amountCents > p.amountCents) {
        throw new PaymentProviderError("Refund amount exceeds the amount paid");
      }
      update(p, { refundedCents: p.refundedCents + amountCents });
      const id = `re_fake_${randomUUID().replace(/-/g, "")}`;
      refundsByKey.set(idempotencyKey, id);
      return { id };
    },
    parseWebhook(rawBody, header) {
      if (!SIGNATURE_HEADERS.some((name) => header(name) === FAKE_SIGNATURE)) {
        throw new WebhookSignatureError();
      }
      return JSON.parse(rawBody.toString("utf8")) as PaymentEvent;
    },
    succeededEvent(paymentId, amountCents) {
      return {
        id: `evt_fake_${randomUUID()}`,
        type: "payment_succeeded",
        ref: { paymentId, sessionId: null },
        paymentId,
        amountCents,
      };
    },
  };
}

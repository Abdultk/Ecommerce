import Stripe from "stripe";
import { currencyExponent } from "@hp/contracts";
import {
  PaymentProviderError,
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentStatus,
} from "./types";

/** Stripe needs three-decimal amounts (OMR, KWD, BHD) to be multiples of 10. */
const THREE_DECIMAL_STEP = 10;

const toEvent = (event: Stripe.Event): PaymentEvent => {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      return {
        id: event.id,
        type: "payment_succeeded",
        ref: { paymentId: intent.id, sessionId: null },
        paymentId: intent.id,
        amountCents: intent.amount_received,
      };
    }
    case "payment_intent.payment_failed":
      return {
        id: event.id,
        type: "payment_failed",
        ref: { paymentId: event.data.object.id, sessionId: null },
        message: event.data.object.last_payment_error?.message ?? "Payment failed",
      };
    case "charge.refunded": {
      const charge = event.data.object;
      const intent =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (!intent) return { id: event.id, type: "ignored" };
      return {
        id: event.id,
        type: "refunded",
        ref: { paymentId: intent, sessionId: null },
        refunds: (charge.refunds?.data ?? []).map((r) => ({ id: r.id, amountCents: r.amount })),
      };
    }
    default:
      return { id: event.id, type: "ignored" };
  }
};

const requirePaymentId = (paymentId: string | null): string => {
  if (!paymentId) throw new PaymentProviderError("Stripe payments need a PaymentIntent id");
  return paymentId;
};

/** Stripe PaymentIntents + Payment Element (kept alongside Amwal Pay). */
export function createStripeGateway(secretKey: string, webhookSecret: string): PaymentGateway {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });

  const clientSecretOf = (intent: Stripe.PaymentIntent) => {
    if (!intent.client_secret) throw new PaymentProviderError("Stripe returned no client secret");
    return {
      kind: "client_secret" as const,
      provider: "stripe" as const,
      clientSecret: intent.client_secret,
    };
  };

  return {
    provider: "stripe",
    supports(currency, amountCents) {
      return currencyExponent(currency) !== 3 || amountCents % THREE_DECIMAL_STEP === 0;
    },
    async createPayment(input) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          receipt_email: input.email,
          automatic_payment_methods: { enabled: true },
          metadata: { orderId: input.orderId, orderNumber: input.orderNumber },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { ref: { paymentId: intent.id, sessionId: null }, payment: clientSecretOf(intent) };
    },
    async resumePayment(ref) {
      return clientSecretOf(await stripe.paymentIntents.retrieve(requirePaymentId(ref.paymentId)));
    },
    async cancelPayment(ref) {
      await stripe.paymentIntents.cancel(requirePaymentId(ref.paymentId));
    },
    async getPaymentStatus(ref): Promise<PaymentStatus> {
      const intent = await stripe.paymentIntents.retrieve(requirePaymentId(ref.paymentId));
      const status =
        intent.status === "succeeded" ||
        intent.status === "processing" ||
        intent.status === "canceled"
          ? intent.status
          : "requires_payment";
      return {
        status,
        amountCents: status === "succeeded" ? intent.amount_received : 0,
        paymentId: intent.id,
      };
    },
    async refund({ paymentId, amountCents, idempotencyKey }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentId, amount: amountCents },
        { idempotencyKey },
      );
      return { id: refund.id };
    },
    parseWebhook(rawBody, header) {
      const signature = header("stripe-signature");
      if (!signature) throw new WebhookSignatureError();
      try {
        return toEvent(stripe.webhooks.constructEvent(rawBody, signature, webhookSecret));
      } catch {
        throw new WebhookSignatureError();
      }
    },
  };
}

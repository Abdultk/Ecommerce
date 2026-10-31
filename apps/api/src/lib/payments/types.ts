import type { CheckoutPayment, CurrencyCode } from "@hp/contracts";

export type PaymentProviderName = "amwal" | "stripe" | "fake";

/** The card variants of the checkout contract (bank transfers never touch a provider). */
export type CardPayment = Extract<CheckoutPayment, { kind: "redirect" | "client_secret" }>;

/**
 * How we find a payment at the provider. Stripe knows the PaymentIntent from the start;
 * hosted checkouts (Amwal Pay, fake) know a session first and a payment id once paid.
 * For Amwal Pay the session is the order number (its merchantReference).
 */
export type PaymentRef = { paymentId: string | null; sessionId: string | null };

/** Payment events the app reacts to, normalised from the provider's webhook payloads. */
export type PaymentEvent =
  | {
      id: string;
      type: "payment_succeeded";
      ref: PaymentRef;
      paymentId: string;
      amountCents: number;
    }
  | { id: string; type: "payment_failed"; ref: PaymentRef; message: string }
  | {
      id: string;
      type: "refunded";
      ref: PaymentRef;
      refunds: { id: string; amountCents: number }[];
    }
  /** The provider says something changed; ask it directly (never trust the payload alone). */
  | { id: string; type: "check_payment"; ref: PaymentRef }
  | { id: string; type: "ignored" };

export type CreatePaymentInput = {
  amountCents: number;
  currency: CurrencyCode;
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  phone: string | null;
  /** Where the hosted page sends the customer back (success or cancel). */
  returnUrl: string;
  idempotencyKey: string;
};

/** What the provider says about a payment; amountCents is what was actually received. */
export type PaymentStatus = {
  status: "succeeded" | "processing" | "requires_payment" | "canceled";
  amountCents: number;
  /** The provider's payment id, once known (Amwal assigns it on payment). */
  paymentId: string | null;
};

export type RefundInput = {
  paymentId: string;
  amountCents: number;
  idempotencyKey: string;
  reason: string;
};

/** Reads one request header (case-insensitive), for webhook signature checks. */
export type HeaderReader = (name: string) => string | undefined;

/** Everything checkout, refunds, webhooks and reconciliation need from a card provider. */
export interface PaymentGateway {
  readonly provider: PaymentProviderName;
  /** False when this provider can't take this currency or amount (e.g. Amwal Pay is OMR only). */
  supports(currency: CurrencyCode, amountCents: number): boolean;
  createPayment(input: CreatePaymentInput): Promise<{ ref: PaymentRef; payment: CardPayment }>;
  /** Rebuilds the payment step for a retried checkout (same Idempotency-Key). */
  resumePayment(ref: PaymentRef): Promise<CardPayment>;
  /** Best effort: a payment that still arrives later is refunded automatically. */
  cancelPayment(ref: PaymentRef): Promise<void>;
  getPaymentStatus(ref: PaymentRef): Promise<PaymentStatus>;
  refund(input: RefundInput): Promise<{ id: string }>;
  /** Verifies the signature and normalises the event. Throws on any verification failure. */
  parseWebhook(rawBody: Buffer, header: HeaderReader): PaymentEvent;
}

export class WebhookSignatureError extends Error {
  constructor() {
    super("Invalid webhook signature");
    this.name = "WebhookSignatureError";
  }
}

/** A provider answered with something we can't use; never shown to customers verbatim. */
export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

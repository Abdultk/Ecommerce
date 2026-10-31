import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createFakeGateway, createStripeGateway, type CreatePaymentInput } from "./index";

const input = (overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput => ({
  amountCents: 1_000,
  currency: "OMR",
  orderId: "o1",
  orderNumber: "HP-2026-000001",
  email: "a@example.test",
  customerName: "Salim",
  phone: "+96891234567",
  returnUrl: "http://localhost:3000/checkout/return?number=HP-2026-000001",
  idempotencyKey: "k1",
  ...overrides,
});

const headers =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

describe("fake gateway", () => {
  it("redirects to the dev fake-pay page for its session", async () => {
    const gateway = createFakeGateway("http://api.test/api/v1/checkout/fake-pay");
    const { ref, payment } = await gateway.createPayment(input());
    expect(payment).toEqual({
      kind: "redirect",
      provider: "fake",
      redirectUrl: `http://api.test/api/v1/checkout/fake-pay/${ref.sessionId}`,
    });
    expect(await gateway.resumePayment(ref)).toEqual(payment);
    expect(gateway.bySession(ref.sessionId!)?.id).toBe(ref.paymentId);
    expect(gateway.bySession("nope")).toBeUndefined();
  });

  it("is idempotent per key", async () => {
    const gateway = createFakeGateway();
    const first = await gateway.createPayment(input({ idempotencyKey: "same" }));
    const again = await gateway.createPayment(input({ idempotencyKey: "same" }));
    expect(again.ref).toEqual(first.ref);
  });

  it("records refunds, rejects over-refunds and replays a repeated key", async () => {
    const gateway = createFakeGateway();
    const { ref } = await gateway.createPayment(input());
    const refund = (amountCents: number, key: string) =>
      gateway.refund({ paymentId: ref.paymentId!, amountCents, idempotencyKey: key, reason: "r" });
    const first = await refund(600, "r1");
    expect((await refund(600, "r1")).id).toBe(first.id);
    await expect(refund(500, "r2")).rejects.toThrow(/exceeds/);
    expect(gateway.intents.get(ref.paymentId!)!.refundedCents).toBe(600);
  });

  it("reports status by payment id or session id", async () => {
    const gateway = createFakeGateway();
    const open = await gateway.createPayment(input({ idempotencyKey: "a" }));
    const paid = await gateway.createPayment(input({ idempotencyKey: "b", amountCents: 2_000 }));
    const dropped = await gateway.createPayment(input({ idempotencyKey: "c" }));
    gateway.markSucceeded(paid.ref.sessionId!);
    gateway.markFailed(open.ref.paymentId!);
    await gateway.cancelPayment(dropped.ref);
    expect(await gateway.getPaymentStatus(open.ref)).toMatchObject({ status: "requires_payment" });
    expect(
      await gateway.getPaymentStatus({ paymentId: null, sessionId: paid.ref.sessionId }),
    ).toEqual({ status: "succeeded", amountCents: 2_000, paymentId: paid.ref.paymentId });
    expect(await gateway.getPaymentStatus(dropped.ref)).toMatchObject({ status: "canceled" });
    await expect(gateway.getPaymentStatus({ paymentId: "x", sessionId: null })).rejects.toThrow();
    await expect(gateway.getPaymentStatus({ paymentId: null, sessionId: null })).rejects.toThrow();
  });

  it("parses its own signed events and rejects unsigned ones", () => {
    const gateway = createFakeGateway();
    const body = Buffer.from(JSON.stringify(gateway.succeededEvent("pi_fake_1", 1_000)));
    expect(
      gateway.parseWebhook(body, headers({ "stripe-signature": "fake-signature" })),
    ).toMatchObject({
      type: "payment_succeeded",
      paymentId: "pi_fake_1",
      amountCents: 1_000,
    });
    expect(() => gateway.parseWebhook(body, headers({ "stripe-signature": "wrong" }))).toThrow(
      /signature/i,
    );
    expect(gateway.supports("KWD", 1)).toBe(true);
  });
});

describe("Stripe gateway", () => {
  const secret = "whsec_test_secret";
  const gateway = createStripeGateway("sk_test_offline", secret);

  const signed = (event: object) => {
    const payload = JSON.stringify(event);
    return {
      body: Buffer.from(payload),
      header: headers({
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret }),
      }),
    };
  };

  it("needs three-decimal amounts in multiples of 10", () => {
    expect(gateway.supports("OMR", 18_500)).toBe(true);
    expect(gateway.supports("OMR", 18_505)).toBe(false);
    expect(gateway.supports("USD", 1_999)).toBe(true);
  });

  it("refuses to look up a payment without a PaymentIntent id", async () => {
    await expect(gateway.getPaymentStatus({ paymentId: null, sessionId: "s" })).rejects.toThrow(
      /PaymentIntent/,
    );
  });

  it("verifies the signature and maps payment_intent.succeeded", () => {
    const { body, header } = signed({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", object: "payment_intent", amount_received: 4_999 } },
    });
    expect(gateway.parseWebhook(body, header)).toEqual({
      id: "evt_1",
      type: "payment_succeeded",
      ref: { paymentId: "pi_1", sessionId: null },
      paymentId: "pi_1",
      amountCents: 4_999,
    });
  });

  it("maps payment failures", () => {
    const { body, header } = signed({
      id: "evt_f",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_2", object: "payment_intent", last_payment_error: null } },
    });
    expect(gateway.parseWebhook(body, header)).toMatchObject({
      type: "payment_failed",
      ref: { paymentId: "pi_2" },
      message: "Payment failed",
    });
  });

  it("maps charge.refunded with every refund on the charge", () => {
    const { body, header } = signed({
      id: "evt_2",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_1",
          object: "charge",
          payment_intent: "pi_1",
          refunds: { data: [{ id: "re_1", amount: 500 }] },
        },
      },
    });
    expect(gateway.parseWebhook(body, header)).toEqual({
      id: "evt_2",
      type: "refunded",
      ref: { paymentId: "pi_1", sessionId: null },
      refunds: [{ id: "re_1", amountCents: 500 }],
    });
  });

  it("ignores refunds without an intent and unhandled types", () => {
    const orphan = signed({
      id: "evt_5",
      type: "charge.refunded",
      data: { object: { id: "ch_2", object: "charge", payment_intent: null } },
    });
    expect(gateway.parseWebhook(orphan.body, orphan.header)).toEqual({
      id: "evt_5",
      type: "ignored",
    });
    const other = signed({ id: "evt_3", type: "customer.created", data: { object: { id: "c" } } });
    expect(gateway.parseWebhook(other.body, other.header)).toEqual({
      id: "evt_3",
      type: "ignored",
    });
  });

  it("rejects a forged or missing signature", () => {
    const { body } = signed({
      id: "evt_4",
      type: "payment_intent.succeeded",
      data: { object: {} },
    });
    expect(() => gateway.parseWebhook(body, headers({ "stripe-signature": "t=1,v1=bad" }))).toThrow(
      /signature/i,
    );
    expect(() => gateway.parseWebhook(body, headers({}))).toThrow(/signature/i);
  });
});

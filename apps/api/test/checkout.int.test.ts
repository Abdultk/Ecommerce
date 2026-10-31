import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { CheckoutIntent, OrderDetail, ShippingOption, envelope } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { releaseExpiredReservations } from "../src/modules/orders/orders.service";
import { OMAN_ADDRESS, buildApp, cookieFrom, prisma, resetDb } from "./helpers";

let ctx = buildApp();

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
});

const variantId = async (sku: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { sku } })).id;

/** A guest cart cookie holding the given lines. */
async function guestCart(lines: [sku: string, quantity: number][]) {
  let cookie: string | undefined;
  for (const [sku, quantity] of lines) {
    const req = request(ctx.app)
      .post("/api/v1/cart/items")
      .send({ variantId: await variantId(sku), quantity });
    const res = await (cookie ? req.set("Cookie", cookie) : req);
    expect(res.status).toBe(200);
    cookie ??= cookieFrom(res, "hp_cart");
  }
  return cookie!;
}

const checkoutBody = (overrides: object = {}) => ({
  email: "ada@example.test",
  shippingAddress: OMAN_ADDRESS,
  shippingMethod: "standard",
  paymentMethod: "card",
  ...overrides,
});

const startCheckout = (cookie: string, body: object = checkoutBody(), key?: string) => {
  const req = request(ctx.app).post("/api/v1/checkout/intent").set("Cookie", cookie).send(body);
  return key ? req.set("Idempotency-Key", key) : req;
};

const payWebhook = (intentId: string, amountCents: number, signature = "fake-signature") =>
  request(ctx.app)
    .post("/api/v1/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signature)
    .send(JSON.stringify(ctx.payments.succeededEvent(intentId, amountCents)));

describe("POST /checkout/shipping-quote", () => {
  it("quotes free standard shipping from OMR 30.000", async () => {
    const cookie = await guestCart([["IV-SK10", 3]]); // OMR 55.500
    const res = await request(ctx.app)
      .post("/api/v1/checkout/shipping-quote")
      .set("Cookie", cookie)
      .send({ shippingAddress: OMAN_ADDRESS });
    const body = envelope(z.array(ShippingOption)).parse(res.body);
    expect(body.success && body.data.map((o) => [o.method, o.priceCents])).toEqual([
      ["standard", 0],
      ["express", 5_000],
    ]);
  });
});

describe("POST /checkout/intent", () => {
  it("reserves stock, prices server-side and returns a client secret", async () => {
    const cookie = await guestCart([["IV-SK10", 2]]);
    const res = await startCheckout(cookie);
    expect(res.status).toBe(201);
    const body = envelope(CheckoutIntent).parse(res.body);
    if (!body.success) throw new Error("expected success");
    // 2 × OMR 18.500 = OMR 37.000, over the OMR 30.000 free-shipping threshold, so standard is
    // free; 5% VAT on the 37.000 goods = 1.850
    expect(body.data.totals).toEqual({
      subtotalCents: 37_000,
      discountCents: 0,
      shippingCents: 0,
      taxCents: 1_850,
      totalCents: 38_850,
    });
    expect(body.data.orderNumber).toMatch(/^HP-\d{4}-000001$/);
    expect(body.data.payment).toMatchObject({
      kind: "redirect",
      redirectUrl: expect.stringContaining("/checkout/fake-pay"),
    });

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant).toMatchObject({ stockOnHand: 24, stockReserved: 2 });
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: body.data.orderNumber },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.reservationExpiresAt).not.toBeNull();
    expect(order.lookupTokenHash).not.toBe(body.data.lookupToken);
  });

  it("is idempotent for a repeated Idempotency-Key", async () => {
    const cookie = await guestCart([["IV-SK10", 1]]);
    const first = await startCheckout(cookie, checkoutBody(), "key-123");
    const second = await startCheckout(cookie, checkoutBody(), "key-123");
    expect(second.status).toBe(201);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);
    expect(await prisma.order.count()).toBe(1);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockReserved).toBe(1);
  });

  it("refuses an empty cart", async () => {
    const res = await request(ctx.app).post("/api/v1/checkout/intent").send(checkoutBody());
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Your cart is empty.");
  });

  it("refuses more than the unreserved stock", async () => {
    const first = await guestCart([["IV-SK12", 6]]); // 8 in stock
    expect((await startCheckout(first)).status).toBe(201); // 6 reserved, 2 left
    const second = await guestCart([["IV-SK12", 2]]);
    // Bump the second cart past what's left (the cart API itself would refuse this).
    const line = await prisma.cartItem.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    await prisma.cartItem.update({ where: { id: line.id }, data: { quantity: 3 } });
    const res = await startCheckout(second);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { available: 2 } });
  });

  it("sells the last unit to exactly one of two simultaneous checkouts", async () => {
    await prisma.productVariant.update({ where: { sku: "BR-CK8" }, data: { stockOnHand: 1 } });
    const [a, b] = [await guestCart([["BR-CK8", 1]]), await guestCart([["BR-CK8", 1]])];
    const results = await Promise.all([startCheckout(a), startCheckout(b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("re-checks the coupon and refuses one that no longer applies", async () => {
    await prisma.coupon.create({
      data: { code: "WELCOME10", type: "PERCENT", value: 10, minSubtotalCents: 5_000 },
    });
    const cookie = await guestCart([["IV-SK10", 2]]);
    await request(ctx.app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie)
      .send({ code: "WELCOME10" });
    await prisma.coupon.update({ where: { code: "WELCOME10" }, data: { isActive: false } });
    const res = await startCheckout(cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("COUPON_INVALID");
  });

  it("counts open checkouts against a coupon's redemption limit", async () => {
    await prisma.coupon.create({
      data: { code: "ONCE", type: "PERCENT", value: 10, maxRedemptions: 1, perCustomerLimit: null },
    });
    const first = await guestCart([["IV-SK10", 1]]);
    await request(ctx.app).post("/api/v1/cart/coupon").set("Cookie", first).send({ code: "ONCE" });
    const second = await guestCart([["IV-SK10", 1]]);
    await request(ctx.app).post("/api/v1/cart/coupon").set("Cookie", second).send({ code: "ONCE" });

    expect((await startCheckout(first)).status).toBe(201); // unpaid, but holds the only redemption
    const res = await startCheckout(second, checkoutBody({ email: "someone-else@example.test" }));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe("That code has been fully redeemed.");
  });

  it("enforces the per-customer coupon limit by email, even for guests", async () => {
    await prisma.coupon.create({
      data: { code: "WELCOME10", type: "PERCENT", value: 10, minSubtotalCents: 0 },
    });
    const cookie1 = await guestCart([["IV-SK10", 1]]);
    await request(ctx.app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie1)
      .send({ code: "WELCOME10" });
    const first = await startCheckout(cookie1);
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: first.body.data.orderNumber },
    });
    await payWebhook(order.providerPaymentId!, order.totalCents);

    const cookie2 = await guestCart([["IV-SK10", 1]]);
    await request(ctx.app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie2)
      .send({ code: "WELCOME10" });
    const second = await startCheckout(cookie2, checkoutBody({ email: "ADA@example.test" }));
    expect(second.status).toBe(422);
    // Generic for guests, so the answer doesn't reveal that this email used the code before.
    expect(second.body.error.message).toBe("That code isn't available for this order.");
  });
});

describe("payment webhook", () => {
  async function pendingOrder() {
    const cookie = await guestCart([["IV-SK10", 2]]);
    const res = await startCheckout(cookie);
    return prisma.order.findUniqueOrThrow({ where: { number: res.body.data.orderNumber } });
  }

  it("marks the order paid, converts the reservation into a sale and empties the cart", async () => {
    const order = await pendingOrder();
    const res = await payWebhook(order.providerPaymentId!, order.totalCents);
    expect(res.status).toBe(200);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "IV-SK10" },
      include: { product: true },
    });
    expect(variant).toMatchObject({ stockOnHand: 22, stockReserved: 0 });
    expect(variant.product.salesCount).toBe(2);
    const sale = await prisma.stockMovement.findFirstOrThrow({
      where: { orderId: order.id, reason: "SALE" },
    });
    expect(sale.delta).toBe(-2);
    expect(await prisma.cartItem.count({ where: { cartId: order.cartId! } })).toBe(0);
    expect(ctx.mailer.outbox.at(-1)?.subject).toContain(order.number);
  });

  it("processes each event once", async () => {
    const order = await pendingOrder();
    const event = ctx.payments.succeededEvent(order.providerPaymentId!, order.totalCents);
    const send = () =>
      request(ctx.app)
        .post("/api/v1/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "fake-signature")
        .send(JSON.stringify(event));
    await send();
    const again = await send();
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ received: true, duplicate: true });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockOnHand).toBe(22);
  });

  it("rejects an invalid signature", async () => {
    const order = await pendingOrder();
    const res = await payWebhook(order.providerPaymentId!, order.totalCents, "forged");
    expect(res.status).toBe(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("does not mark an order paid when the amount doesn't match", async () => {
    const order = await pendingOrder();
    const res = await payWebhook(order.providerPaymentId!, order.totalCents - 1);
    expect(res.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "PENDING_PAYMENT",
    );
    expect(
      await prisma.orderEvent.count({
        where: { orderId: order.id, type: "payment_amount_mismatch" },
      }),
    ).toBe(1);
    // The mismatched payment is sent back rather than left captured.
    expect(ctx.payments.intents.get(order.providerPaymentId!)?.refundedCents).toBe(
      order.totalCents - 1,
    );
  });

  it("refunds a payment that arrives after the reservation expired", async () => {
    const order = await pendingOrder();
    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1_000) },
    });
    await releaseExpiredReservations({ db: prisma, payments: ctx.payments, mailer: ctx.mailer });
    await payWebhook(order.providerPaymentId!, order.totalCents);

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { refunds: true },
    });
    expect(after.status).toBe("CANCELLED");
    expect(after.refundedCents).toBe(order.totalCents);
    expect(after.refunds).toHaveLength(1);
  });
});

describe("reservation expiry", () => {
  it("cancels unpaid orders past their reservation and releases the stock", async () => {
    const cookie = await guestCart([["IV-SK10", 2]]);
    const res = await startCheckout(cookie);
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: res.body.data.orderNumber },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1_000) },
    });

    expect(
      await releaseExpiredReservations({ db: prisma, payments: ctx.payments, mailer: ctx.mailer }),
    ).toBe(1);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CANCELLED");
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockReserved).toBe(0);
    expect(ctx.payments.intents.get(order.providerPaymentId!)?.cancelled).toBe(true);
  });

  it("leaves orders whose reservation is still valid", async () => {
    const cookie = await guestCart([["IV-SK10", 1]]);
    await startCheckout(cookie);
    expect(
      await releaseExpiredReservations({ db: prisma, payments: ctx.payments, mailer: ctx.mailer }),
    ).toBe(0);
  });
});

describe("POST /checkout/fake-confirm (local development)", () => {
  it("completes payment without Stripe", async () => {
    const cookie = await guestCart([["IV-SK10", 1]]);
    const intent = await startCheckout(cookie);
    const res = await request(ctx.app)
      .post("/api/v1/checkout/fake-confirm")
      .send({ orderNumber: intent.body.data.orderNumber });
    expect(res.status).toBe(200);
    const body = envelope(OrderDetail).parse(res.body);
    expect(body.success && body.data.status).toBe("PAID");
  });
});

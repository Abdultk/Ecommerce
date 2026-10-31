import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { seedCatalog } from "../prisma/seed";
import { createMemoryMailer } from "../src/lib/mailer";
import { purgeExpiredCarts, purgeIdempotencyRecords } from "../src/modules/maintenance/jobs";
import { sendLowStockAlerts } from "../src/modules/maintenance/low-stock-alert";
import { releaseExpiredReservations } from "../src/modules/orders/orders.service";
import { reconcilePayments } from "../src/modules/payments/reconcile-payments";
import { OMAN_ADDRESS, buildApp, cookieFrom, createUser, prisma, resetDb } from "./helpers";

let ctx = buildApp();

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
});

describe("low-stock alerts", () => {
  let mailer = createMemoryMailer();

  beforeEach(async () => {
    mailer = createMemoryMailer();
    await createUser({ role: "ADMIN", email: "admin@example.test" });
    await createUser({ role: "SUPER_ADMIN", email: "root@example.test" });
    await createUser({ role: "ADMIN", email: "gone@example.test", disabled: true });
    await createUser({ role: "STAFF", email: "staff@example.test" });
    // Start from a healthy catalogue: everything well above its threshold.
    await prisma.productVariant.updateMany({ data: { stockOnHand: 50, lowStockThreshold: 5 } });
  });

  const setStock = (sku: string, stockOnHand: number) =>
    prisma.productVariant.update({ where: { sku }, data: { stockOnHand } });

  it("emails active admins once per dip, listing the low SKUs", async () => {
    await setStock("IV-SK10", 3);
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(1);
    expect(mailer.outbox.map((m) => m.to).sort()).toEqual([
      "admin@example.test",
      "root@example.test",
    ]);
    expect(mailer.outbox[0]!.subject).toContain("IV-SK10");
    expect(mailer.outbox[0]!.text).toContain("IV-SK10: 3 available (alert at 5)");

    // Still low: no repeat.
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(0);
    expect(mailer.outbox).toHaveLength(2);

    // Recovers, then dips again: alerts again.
    await setStock("IV-SK10", 40);
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(0);
    await setStock("IV-SK10", 1);
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(1);
    expect(mailer.outbox).toHaveLength(4);
  });

  it("also notifies LOW_STOCK_ALERT_EMAIL-style extra recipients, without duplicates", async () => {
    await setStock("IV-SK10", 0);
    await sendLowStockAlerts(prisma, mailer, ["ops@example.test", "admin@example.test"]);
    expect(mailer.outbox.map((m) => m.to).sort()).toEqual([
      "admin@example.test",
      "ops@example.test",
      "root@example.test",
    ]);
  });

  it("ignores inactive variants and archived products", async () => {
    const variant = await setStock("IV-SK10", 0);
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(0);
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: true } });
    await prisma.product.update({ where: { id: variant.productId }, data: { status: "ARCHIVED" } });
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(0);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("sends only after the claim is committed (no email inside a transaction)", async () => {
    await setStock("IV-SK10", 0);
    const seenDuringSend: (Date | null)[] = [];
    const observing = {
      send: async () => {
        const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
        seenDuringSend.push(v.lowStockAlertedAt);
      },
    };
    await sendLowStockAlerts(prisma, observing);
    expect(seenDuringSend.length).toBeGreaterThan(0);
    expect(seenDuringSend.every((d) => d instanceof Date)).toBe(true);
  });

  it("keeps the alert pending if the email can't be sent", async () => {
    await setStock("IV-SK10", 0);
    const failing = {
      send: async () => {
        throw new Error("smtp down");
      },
    };
    await expect(sendLowStockAlerts(prisma, failing)).rejects.toThrow();
    expect(await sendLowStockAlerts(prisma, mailer)).toBe(1);
  });
});

describe("payment reconciliation", () => {
  const MINUTES = 60_000;

  async function pendingOrder(ageMinutes: number) {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    const added = await request(ctx.app)
      .post("/api/v1/cart/items")
      .send({ variantId: variant.id, quantity: 1 });
    const intent = await request(ctx.app)
      .post("/api/v1/checkout/intent")
      .set("Cookie", cookieFrom(added, "hp_cart")!)
      .send({
        email: "ada@example.test",
        shippingAddress: OMAN_ADDRESS,
        shippingMethod: "standard",
        paymentMethod: "card",
      });
    expect(intent.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: intent.body.data.orderNumber },
    });
    return prisma.order.update({
      where: { id: order.id },
      data: { createdAt: new Date(Date.now() - ageMinutes * MINUTES) },
    });
  }

  const deps = () => ({ db: prisma, payments: ctx.payments, mailer: ctx.mailer });

  it("marks a pending order paid when the provider says the payment succeeded", async () => {
    const order = await pendingOrder(10);
    ctx.payments.markSucceeded(order.providerPaymentId!);
    expect(await reconcilePayments(deps())).toEqual({ checked: 1, recovered: 1, failed: 0 });
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");
    expect(await prisma.stockMovement.count({ where: { orderId: order.id, reason: "SALE" } })).toBe(
      1,
    );
    // Running again (or the late webhook) changes nothing.
    expect(await reconcilePayments(deps())).toEqual({ checked: 0, recovered: 0, failed: 0 });
  });

  it("leaves young or unpaid checkouts alone", async () => {
    const young = await pendingOrder(1);
    ctx.payments.markSucceeded(young.providerPaymentId!);
    await pendingOrder(10); // never paid
    expect(await reconcilePayments(deps())).toEqual({ checked: 1, recovered: 0, failed: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: young.id } })).status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("refunds a payment that succeeded after the order expired", async () => {
    const order = await pendingOrder(10);
    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: new Date(Date.now() - MINUTES) },
    });
    await releaseExpiredReservations({ db: prisma, payments: ctx.payments, mailer: ctx.mailer });
    ctx.payments.markSucceeded(order.providerPaymentId!);
    expect(await reconcilePayments(deps())).toMatchObject({ recovered: 1 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.refundedCents).toBe(after.totalCents);
  });

  it("keeps going when the provider fails for one order", async () => {
    const broken = await pendingOrder(10);
    await prisma.order.update({
      where: { id: broken.id },
      data: { providerPaymentId: "pi_unknown_to_provider" },
    });
    const good = await pendingOrder(10);
    ctx.payments.markSucceeded(good.providerPaymentId!);
    expect(await reconcilePayments(deps())).toEqual({ checked: 2, recovered: 1, failed: 1 });
  });
});

describe("expired guest cart purge (review #5)", () => {
  it("purges in batches and isn't stuck behind carts that unpaid orders still hold", async () => {
    const past = new Date(Date.now() - 3_600_000);
    const held = await prisma.cart.create({
      data: { expiresAt: new Date(past.getTime() - 60_000) },
    });
    await prisma.order.create({
      data: {
        number: "HP-2026-999001",
        email: "ada@example.test",
        cartId: held.id,
        subtotalCents: 100,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 100,
        shippingAddress: OMAN_ADDRESS,
        shippingMethod: "standard",
        paymentMethod: "CARD",
      },
    });
    for (let i = 0; i < 3; i += 1) await prisma.cart.create({ data: { expiresAt: past } });
    await prisma.cart.create({ data: { expiresAt: new Date(Date.now() + 3_600_000) } });

    expect(await purgeExpiredCarts(prisma, new Date(), 1)).toBe(3);
    const left = await prisma.cart.findMany({ select: { id: true } });
    expect(left.map((c) => c.id)).toContain(held.id);
    expect(left).toHaveLength(2); // the held cart and the unexpired one
  });
});

describe("idempotency record purge", () => {
  it("deletes records older than a day", async () => {
    await prisma.idempotencyRecord.createMany({
      data: [
        {
          scope: "admin:x",
          key: "old",
          requestHash: "h",
          createdAt: new Date(Date.now() - 25 * 3_600_000),
        },
        { scope: "admin:x", key: "new", requestHash: "h" },
      ],
    });
    expect(await purgeIdempotencyRecords(prisma)).toBe(1);
    expect((await prisma.idempotencyRecord.findMany()).map((r) => r.key)).toEqual(["new"]);
  });
});

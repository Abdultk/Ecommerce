import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Redis } from "ioredis";
import { seedCatalog } from "../prisma/seed";
import { hashToken } from "../src/lib/crypto";
import { logger } from "../src/lib/logger";
import { collectOpsMetrics, type QueueProbe } from "../src/modules/maintenance/ops-metrics";
import { OMAN_ADDRESS, buildApp, cookieFrom, prisma, resetDb } from "./helpers";

let ctx = buildApp();

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
});

afterEach(() => vi.restoreAllMocks());

async function startCheckout() {
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
  return { order, token: intent.body.data.lookupToken as string };
}

describe("ORDER_LOOKUP_SECRET rotation", () => {
  it("rejects tokens made with a previous secret, even if their hash was stored", async () => {
    const { order, token } = await startCheckout();
    const lookup = (t: string) =>
      request(ctx.app).post("/api/v1/orders/lookup").send({ number: order.number, token: t });
    expect((await lookup(token)).status).toBe(200);

    // Simulate an order issued before rotation: its link carries a token from the old
    // secret and the database holds that token's hash.
    const oldToken = createHmac("sha256", "the-previous-order-lookup-secret-0123456789")
      .update(`order-lookup:v1:${order.id}`)
      .digest("base64url");
    await prisma.order.update({
      where: { id: order.id },
      data: { lookupTokenHash: hashToken(oldToken) },
    });
    expect((await lookup(oldToken)).status).toBe(404);
    // The current secret's token still works.
    expect((await lookup(token)).status).toBe(200);
  });
});

describe("GET /health/live", () => {
  it("answers 200 while a dependency is down (no DB or Redis call)", async () => {
    const brokenRedis = { ping: () => Promise.reject(new Error("redis down")) } as unknown as Redis;
    ctx = buildApp({ redis: brokenRedis });
    const ready = await request(ctx.app).get("/api/v1/health");
    expect(ready.status).toBe(503);
    const live = await request(ctx.app).get("/api/v1/health/live");
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ success: true, data: { status: "ok" }, error: null });
    expect(live.headers["cache-control"]).toBe("no-store");
  });
});

describe("stripe.webhook log line", () => {
  const send = (body: object, signature = "fake-signature") =>
    request(ctx.app)
      .post("/api/v1/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(JSON.stringify(body));

  const webhookLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls
      .filter((c: unknown[]) => c[1] === "payments.webhook")
      .map((c: unknown[]) => c[0]);

  it("logs one line per request with outcome and type, never the payload", async () => {
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const { order } = await startCheckout();
    const event = ctx.payments.succeededEvent(order.providerPaymentId!, order.totalCents);

    expect((await send(event)).status).toBe(200);
    expect((await send(event)).status).toBe(200);
    expect((await send(event, "forged")).status).toBe(400);

    const lines = [...webhookLines(info), ...webhookLines(warn)];
    expect(lines).toEqual([
      {
        event: "payments.webhook",
        provider: "stripe",
        outcome: "processed",
        type: "payment_succeeded",
        eventId: expect.any(String),
      },
      {
        event: "payments.webhook",
        provider: "stripe",
        outcome: "duplicate",
        type: "payment_succeeded",
        eventId: expect.any(String),
      },
      {
        event: "payments.webhook",
        provider: "stripe",
        outcome: "invalid_signature",
        type: null,
        eventId: null,
      },
    ]);
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(order.providerPaymentId!);
    expect(logged).not.toContain(String(order.totalCents));
  });
});

describe("ops metrics", () => {
  it("summarises orders, queues and payment problems", async () => {
    const now = new Date();
    const { order: pending } = await startCheckout();
    await prisma.order.update({
      where: { id: pending.id },
      data: { reservationExpiresAt: new Date(now.getTime() - 60_000) },
    });
    const { order: paid } = await startCheckout();
    await ctx.payments.markSucceeded(paid.providerPaymentId!);
    await request(ctx.app).post("/api/v1/checkout/fake-confirm").send({ orderNumber: paid.number });
    await prisma.orderEvent.create({
      data: { orderId: paid.id, type: "refund_failed", message: "x" },
    });

    const probe: QueueProbe = {
      name: "email",
      counts: async () => ({ waiting: 2, active: 0, delayed: 1, failed: 3 }),
      oldestWaitingAt: async () => new Date(now.getTime() - 90_000),
    };
    const metrics = await collectOpsMetrics(prisma, [probe], now);
    expect(metrics).toEqual({
      paidOrdersLast3h: 1,
      overduePendingOrders: 1,
      paymentIssuesLast15m: 1,
      queues: { email: { waiting: 2, active: 0, delayed: 1, failed: 3 } },
      oldestWaitingEmailSeconds: 90,
    });
  });
});

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { MAX_CART_LINES } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { Prisma } from "@prisma/client";
import { fingerprint } from "../src/lib/fingerprint";
import { createFakeGateway } from "../src/lib/payments";
import { OMAN_ADDRESS, bearer, buildApp, cookieFrom, createUser, prisma, resetDb } from "./helpers";

let ctx = buildApp();

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
});

const variantId = async (sku: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { sku } })).id;

async function guestCart(sku = "IV-SK10", quantity = 1, ip?: string) {
  const req = request(ctx.app)
    .post("/api/v1/cart/items")
    .send({ variantId: await variantId(sku), quantity });
  const res = await (ip ? req.set("X-Forwarded-For", ip) : req);
  expect(res.status).toBe(200);
  return cookieFrom(res, "hp_cart")!;
}

const checkoutBody = (overrides: object = {}) => ({
  email: "ada@example.test",
  shippingAddress: OMAN_ADDRESS,
  shippingMethod: "standard",
  paymentMethod: "card",
  ...overrides,
});

function checkout(
  cookie: string,
  body: object = checkoutBody(),
  opts: { key?: string; ip?: string } = {},
) {
  let req = request(ctx.app).post("/api/v1/checkout/intent").set("Cookie", cookie);
  if (opts.key) req = req.set("Idempotency-Key", opts.key);
  if (opts.ip) req = req.set("X-Forwarded-For", opts.ip);
  return req.send(body);
}

describe("guest lookup tokens", () => {
  it("are derived from ORDER_LOOKUP_SECRET, not the refresh-token pepper", async () => {
    const res = await checkout(await guestCart());
    expect(res.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: res.body.data.orderNumber },
    });
    const expected = createHmac("sha256", process.env.ORDER_LOOKUP_SECRET!)
      .update(`order-lookup:v1:${order.id}`)
      .digest("base64url");
    expect(res.body.data.lookupToken).toBe(expected);
  });
});

describe("cart line cap", () => {
  it(`refuses a ${MAX_CART_LINES + 1}st distinct item with a clear message`, async () => {
    const category = await prisma.category.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        slug: "spice-jar-collection",
        name: "Spice jar collection",
        description: "Jars.",
        status: "ACTIVE",
        categoryId: category.id,
        variants: {
          create: Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({
            sku: `JAR-${i}`,
            name: `Jar ${i}`,
            priceCents: 500,
            stockOnHand: 10,
          })),
        },
      },
      include: { variants: { orderBy: { sku: "asc" } } },
    });
    let cookie: string | undefined;
    for (const variant of product.variants.slice(0, MAX_CART_LINES)) {
      const req = request(ctx.app)
        .post("/api/v1/cart/items")
        .send({ variantId: variant.id, quantity: 1 });
      const res = await (cookie ? req.set("Cookie", cookie) : req);
      expect(res.status).toBe(200);
      cookie ??= cookieFrom(res, "hp_cart");
    }
    const extra = await request(ctx.app)
      .post("/api/v1/cart/items")
      .set("Cookie", cookie!)
      .send({ variantId: product.variants[MAX_CART_LINES]!.id, quantity: 1 });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: `Your cart can hold up to ${MAX_CART_LINES} different items.`,
    });
    // Topping up an existing line is still allowed.
    const more = await request(ctx.app)
      .post("/api/v1/cart/items")
      .set("Cookie", cookie!)
      .send({ variantId: product.variants[0]!.id, quantity: 1 });
    expect(more.status).toBe(200);
  });
});

describe("checkout Idempotency-Key fingerprint", () => {
  it("replays the same request but refuses the key with a different body", async () => {
    const cookie = await guestCart();
    const first = await checkout(cookie, checkoutBody(), { key: "k-123" });
    const again = await checkout(cookie, checkoutBody(), { key: "k-123" });
    expect(again.status).toBe(201);
    expect(again.body.data.orderNumber).toBe(first.body.data.orderNumber);

    const changed = await checkout(cookie, checkoutBody({ shippingMethod: "express" }), {
      key: "k-123",
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("CONFLICT");
  });

  it("refuses the key after the cart contents changed", async () => {
    const cookie = await guestCart();
    await checkout(cookie, checkoutBody(), { key: "k-cart" });
    const add = await request(ctx.app)
      .post("/api/v1/cart/items")
      .set("Cookie", cookie)
      .send({ variantId: await variantId("IV-SK10"), quantity: 1 });
    expect(add.status).toBe(200);
    const retry = await checkout(cookie, checkoutBody(), { key: "k-cart" });
    expect(retry.status).toBe(409);
  });
});

describe("checkout retry after the payment provider fails (review #1)", () => {
  it("lets the same Idempotency-Key start a fresh checkout", async () => {
    const real = createFakeGateway();
    let failNext = true;
    const flaky: typeof real = {
      ...real,
      async createPayment(input) {
        if (failNext) {
          failNext = false;
          throw new Error("provider unavailable");
        }
        return real.createPayment(input);
      },
    };
    ctx = buildApp({ payments: flaky });
    const cookie = await guestCart();
    const failed = await checkout(cookie, checkoutBody(), { key: "retry-key" });
    expect(failed.status).toBe(402);
    const abandoned = await prisma.order.findFirstOrThrow({ where: { status: "CANCELLED" } });
    expect(abandoned.idempotencyKey).toBeNull();

    const retry = await checkout(cookie, checkoutBody(), { key: "retry-key" });
    expect(retry.status).toBe(201);
    expect(retry.body.data.orderNumber).not.toBe(abandoned.number);
    // And the retry itself is idempotent from here on.
    const again = await checkout(cookie, checkoutBody(), { key: "retry-key" });
    expect(again.body.data.orderNumber).toBe(retry.body.data.orderNumber);
  });
});

describe("stock-hold abuse", () => {
  it("holds stock for 15 minutes", async () => {
    const before = Date.now();
    const res = await checkout(await guestCart());
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: res.body.data.orderNumber },
    });
    const holdMs = order.reservationExpiresAt!.getTime() - before;
    expect(holdMs).toBeGreaterThan(14 * 60_000);
    expect(holdMs).toBeLessThanOrEqual(15 * 60_000 + 5_000);
  });

  it("caps open unpaid checkouts per email", async () => {
    ctx = buildApp({ limits: { openCheckoutsPerEmail: 2 } });
    for (let i = 0; i < 2; i += 1) {
      expect((await checkout(await guestCart())).status).toBe(201);
    }
    const third = await checkout(await guestCart(), checkoutBody({ email: "ADA@example.test" }));
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    // A different shopper is unaffected.
    expect(
      (await checkout(await guestCart(), checkoutBody({ email: "bo@example.test" }))).status,
    ).toBe(201);
  });

  it("doesn't let another client block a shopper's email (M3)", async () => {
    ctx = buildApp({ limits: { openCheckoutsPerEmail: 2 } });
    const attacker = "203.0.113.50";
    for (let i = 0; i < 2; i += 1) {
      expect((await checkout(await guestCart(), checkoutBody(), { ip: attacker })).status).toBe(
        201,
      );
    }
    expect((await checkout(await guestCart(), checkoutBody(), { ip: attacker })).status).toBe(429);
    const victim = await checkout(await guestCart(), checkoutBody(), { ip: "198.51.100.20" });
    expect(victim.status).toBe(201);
  });

  it("caps open unpaid checkouts per client address", async () => {
    ctx = buildApp({ limits: { openCheckoutsPerClient: 2 } });
    const ip = "203.0.113.7";
    for (const email of ["a@example.test", "b@example.test"]) {
      expect((await checkout(await guestCart(), checkoutBody({ email }), { ip })).status).toBe(201);
    }
    const third = await checkout(await guestCart(), checkoutBody({ email: "c@example.test" }), {
      ip,
    });
    expect(third.status).toBe(429);
    const elsewhere = await checkout(await guestCart(), checkoutBody({ email: "d@example.test" }), {
      ip: "198.51.100.9",
    });
    expect(elsewhere.status).toBe(201);
  });

  it("doesn't count a checkout that the same cart supersedes", async () => {
    ctx = buildApp({ limits: { openCheckoutsPerEmail: 1 } });
    const cookie = await guestCart();
    expect((await checkout(cookie)).status).toBe(201);
    expect((await checkout(cookie, checkoutBody({ shippingMethod: "express" }))).status).toBe(201);
  });
});

describe("admin Idempotency-Key", () => {
  let admin: { id: string; role: "ADMIN" };
  let token: string;

  beforeEach(async () => {
    admin = (await createUser({ role: "ADMIN", email: "admin@example.test" })) as typeof admin;
    token = bearer(admin);
  });

  const adjust = (body: object, key?: string, auth = token) => {
    const req = request(ctx.app).post("/api/v1/admin/inventory/adjust").set("Authorization", auth);
    return (key ? req.set("Idempotency-Key", key) : req).send(body);
  };

  async function paidOrder() {
    const intent = await checkout(await guestCart("IV-SK10", 2));
    await request(ctx.app)
      .post("/api/v1/checkout/fake-confirm")
      .send({ orderNumber: intent.body.data.orderNumber });
    return prisma.order.findUniqueOrThrow({ where: { number: intent.body.data.orderNumber } });
  }

  it("applies a stock adjustment once and replays the first answer", async () => {
    const id = await variantId("IV-SK10");
    const before = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockOnHand;
    const body = { variantId: id, delta: 5, reason: "RESTOCK" };
    const first = await adjust(body, "adj-1");
    const second = await adjust({ reason: "RESTOCK", delta: 5, variantId: id }, "adj-1");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    const after = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockOnHand;
    expect(after).toBe(before + 5);
    expect(await prisma.stockMovement.count({ where: { variantId: id, reason: "RESTOCK" } })).toBe(
      2,
    );
  });

  it("returns 409 when the key comes back with a different body", async () => {
    const id = await variantId("IV-SK10");
    await adjust({ variantId: id, delta: 5, reason: "RESTOCK" }, "adj-2");
    const changed = await adjust({ variantId: id, delta: 6, reason: "RESTOCK" }, "adj-2");
    expect(changed.status).toBe(409);
    expect(changed.body.error.message).toMatch(/different request/);
  });

  it("keeps keys private to each admin and still works without a key", async () => {
    const id = await variantId("IV-SK10");
    const other = bearer(await createUser({ role: "ADMIN", email: "other@example.test" }));
    expect((await adjust({ variantId: id, delta: 1, reason: "RESTOCK" }, "shared")).status).toBe(
      200,
    );
    expect(
      (await adjust({ variantId: id, delta: 2, reason: "RESTOCK" }, "shared", other)).status,
    ).toBe(200);
    expect((await adjust({ variantId: id, delta: 1, reason: "RESTOCK" })).status).toBe(200);
    expect((await adjust({ variantId: id, delta: 1, reason: "RESTOCK" })).status).toBe(200);
  });

  const adjustHash = (body: object) =>
    fingerprint({ method: "POST", path: "/api/v1/admin/inventory/adjust", body });
  const MINUTE = 60_000;

  it("answers 409 while the same key is still in flight, well past a minute", async () => {
    const id = await variantId("IV-SK10");
    const body = { variantId: id, delta: 3, reason: "RESTOCK" };
    await prisma.idempotencyRecord.create({
      data: {
        scope: `admin:${admin.id}`,
        key: "slow",
        requestHash: adjustHash(body),
        createdAt: new Date(Date.now() - 5 * MINUTE),
      },
    });
    const res = await adjust(body, "slow");
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/still being processed/);
  });

  it("takes over a key abandoned longer ago than any request can run", async () => {
    const id = await variantId("IV-SK10");
    const before = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockOnHand;
    const body = { variantId: id, delta: 3, reason: "RESTOCK" };
    await prisma.idempotencyRecord.create({
      data: {
        scope: `admin:${admin.id}`,
        key: "crashed",
        requestHash: adjustHash(body),
        createdAt: new Date(Date.now() - 11 * MINUTE),
      },
    });
    expect((await adjust(body, "crashed")).status).toBe(200);
    const after = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockOnHand;
    expect(after).toBe(before + 3);
  });

  it("applies concurrent requests with the same key once", async () => {
    const id = await variantId("IV-SK10");
    const before = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockOnHand;
    const body = { variantId: id, delta: 4, reason: "RESTOCK" };
    const results = await Promise.all([adjust(body, "race"), adjust(body, "race")]);
    const statuses = results.map((r) => r.status).sort();
    expect([
      [200, 200],
      [200, 409],
    ]).toContainEqual(statuses);
    const after = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockOnHand;
    expect(after).toBe(before + 4);
  });

  it("never refunds twice when a finished refund's record is taken over (M5)", async () => {
    const order = await paidOrder();
    const send = () =>
      request(ctx.app)
        .post(`/api/v1/admin/orders/${order.id}/refund`)
        .set("Authorization", token)
        .set("Idempotency-Key", "refund-lost")
        .send({ amountCents: 500 });
    expect((await send()).status).toBe(200);
    // As if the final record update had failed and the record then went stale.
    await prisma.idempotencyRecord.updateMany({
      where: { key: "refund-lost" },
      data: {
        responseStatus: null,
        responseBody: Prisma.DbNull,
        createdAt: new Date(Date.now() - 11 * MINUTE),
      },
    });
    expect((await send()).status).toBe(200);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.refundedCents).toBe(500);
    expect(ctx.payments.intents.get(order.providerPaymentId!)!.refundedCents).toBe(500);
  });

  it("rejects a malformed key", async () => {
    const id = await variantId("IV-SK10");
    const res = await adjust({ variantId: id, delta: 1, reason: "RESTOCK" }, "bad key!");
    expect(res.status).toBe(400);
  });

  it("lets a failed attempt be retried with the same key", async () => {
    const id = await variantId("IV-SK10");
    const tooMuch = await adjust({ variantId: id, delta: -100_000, reason: "DAMAGE" }, "retry");
    expect(tooMuch.status).toBe(400);
    const fixed = await adjust({ variantId: id, delta: -100_000, reason: "DAMAGE" }, "retry");
    expect(fixed.status).toBe(400); // re-executed, not a replay
    expect(fixed.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("refunds once for a repeated refund request", async () => {
    const order = await paidOrder();
    const send = () =>
      request(ctx.app)
        .post(`/api/v1/admin/orders/${order.id}/refund`)
        .set("Authorization", token)
        .set("Idempotency-Key", "refund-1")
        .send({ amountCents: 500, reason: "Dent" });
    expect((await send()).status).toBe(200);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).refundedCents).toBe(
      500,
    );
    const audits = await prisma.auditLog.findMany({ where: { action: "order.refund" } });
    expect(audits).toHaveLength(1);
  });

  it("replays a repeated cancel instead of failing, with one audit entry", async () => {
    const order = await paidOrder();
    const send = () =>
      request(ctx.app)
        .post(`/api/v1/admin/orders/${order.id}/cancel`)
        .set("Authorization", token)
        .set("Idempotency-Key", "cancel-1")
        .send({ reason: "Customer asked" });
    expect((await send()).status).toBe(200);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.body.data.order.status).toBe("CANCELLED");
    const audits = await prisma.auditLog.findMany({ where: { action: "order.cancel" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toMatchObject({ status: "PAID" });
  });

  it("writes no cancel audit entry when the cancel is refused", async () => {
    const order = await paidOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: "SHIPPED" } });
    const res = await request(ctx.app)
      .post(`/api/v1/admin/orders/${order.id}/cancel`)
      .set("Authorization", token)
      .send({});
    expect(res.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "order.cancel" } })).toBe(0);
  });
});

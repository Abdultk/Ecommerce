import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { OrderDetail, OrderSummary, envelope } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { OMAN_ADDRESS, bearer, buildApp, cookieFrom, createUser, prisma, resetDb } from "./helpers";

let ctx = buildApp();

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
});

const variantId = async (sku: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { sku } })).id;

type Shopper = { auth?: string; cookie?: string };

/** Puts items in a cart (a user's when `auth` is given) and starts checkout. */
async function checkout(shopper: Shopper, sku = "IV-SK10", quantity = 2) {
  const withIdentity = (req: request.Test) => {
    if (shopper.auth) req.set("Authorization", shopper.auth);
    if (shopper.cookie) req.set("Cookie", shopper.cookie);
    return req;
  };
  const added = await withIdentity(
    request(ctx.app)
      .post("/api/v1/cart/items")
      .send({ variantId: await variantId(sku), quantity }),
  );
  expect(added.status).toBe(200);
  shopper.cookie ??= cookieFrom(added, "hp_cart");
  const res = await withIdentity(
    request(ctx.app).post("/api/v1/checkout/intent").send({
      email: "ada@example.test",
      shippingAddress: OMAN_ADDRESS,
      shippingMethod: "standard",
      paymentMethod: "card",
    }),
  );
  expect(res.status).toBe(201);
  return res.body.data as { orderNumber: string; lookupToken: string };
}

async function paidOrder(shopper: Shopper, sku?: string, quantity?: number) {
  const intent = await checkout(shopper, sku, quantity);
  const res = await request(ctx.app)
    .post("/api/v1/checkout/fake-confirm")
    .send({ orderNumber: intent.orderNumber });
  expect(res.status).toBe(200);
  return intent;
}

describe("GET /orders", () => {
  it("requires sign-in", async () => {
    expect((await request(ctx.app).get("/api/v1/orders")).status).toBe(401);
  });

  it("lists the customer's own paid orders, newest first, without abandoned checkouts", async () => {
    const ada = await createUser();
    const auth = bearer(ada);
    const first = await paidOrder({ auth });
    const second = await paidOrder({ auth }, "BR-CK8", 1);
    await checkout({ auth }); // started, never paid
    await paidOrder({ auth: bearer(await createUser()) }); // someone else's

    const res = await request(ctx.app).get("/api/v1/orders").set("Authorization", auth);
    const body = envelope(z.array(OrderSummary)).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.map((o) => o.number)).toEqual([second.orderNumber, first.orderNumber]);
    expect(body.meta).toMatchObject({ page: 1, total: 2 });
  });
});

describe("GET /orders/:number", () => {
  it("returns the customer's order and hides other customers' orders", async () => {
    const ada = await createUser();
    const order = await paidOrder({ auth: bearer(ada) });

    const own = await request(ctx.app)
      .get(`/api/v1/orders/${order.orderNumber}`)
      .set("Authorization", bearer(ada));
    const body = envelope(OrderDetail).parse(own.body);
    expect(body.success && body.data).toMatchObject({
      number: order.orderNumber,
      status: "PAID",
      itemCount: 2,
    });

    const other = await request(ctx.app)
      .get(`/api/v1/orders/${order.orderNumber}`)
      .set("Authorization", bearer(await createUser()));
    expect(other.status).toBe(404);
  });
});

describe("POST /orders/lookup (guests)", () => {
  it("returns the order for the right token", async () => {
    const order = await paidOrder({});
    const res = await request(ctx.app)
      .post("/api/v1/orders/lookup")
      .send({ number: order.orderNumber, token: order.lookupToken });
    const body = envelope(OrderDetail).parse(res.body);
    expect(body.success && body.data.status).toBe("PAID");
  });

  it("gives the same not-found answer for a wrong token or an unknown order", async () => {
    const order = await paidOrder({});
    const wrong = await request(ctx.app)
      .post("/api/v1/orders/lookup")
      .send({ number: order.orderNumber, token: "x".repeat(43) });
    const unknown = await request(ctx.app)
      .post("/api/v1/orders/lookup")
      .send({ number: "HP-2026-999999", token: order.lookupToken });
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it("emails a lookup link that works", async () => {
    const order = await paidOrder({});
    const mail = ctx.mailer.outbox.find((m) => m.subject.includes(order.orderNumber));
    expect(mail?.text).toContain(`#token=${order.lookupToken}`);
  });
});

describe("POST /orders/:number/cancel", () => {
  it("cancels an unpaid order and releases its stock", async () => {
    const ada = await createUser();
    const order = await checkout({ auth: bearer(ada) });
    const res = await request(ctx.app)
      .post(`/api/v1/orders/${order.orderNumber}/cancel`)
      .set("Authorization", bearer(ada));
    expect(res.status).toBe(200);
    expect(envelope(OrderDetail).parse(res.body).success && res.body.data.status).toBe("CANCELLED");
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockReserved).toBe(0);
  });

  it("refunds a paid order in full and puts the stock back", async () => {
    const ada = await createUser();
    const order = await paidOrder({ auth: bearer(ada) });
    const res = await request(ctx.app)
      .post(`/api/v1/orders/${order.orderNumber}/cancel`)
      .set("Authorization", bearer(ada));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "CANCELLED", refundState: "FULL" });

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockOnHand).toBe(24);
    expect(await prisma.stockMovement.count({ where: { reason: "RETURN" } })).toBe(1);
    expect(ctx.mailer.outbox.at(-1)?.subject).toContain("cancelled");
  });

  it("refuses once the order is being prepared", async () => {
    const ada = await createUser();
    const order = await paidOrder({ auth: bearer(ada) });
    await prisma.order.update({
      where: { number: order.orderNumber },
      data: { status: "PROCESSING" },
    });
    const res = await request(ctx.app)
      .post(`/api/v1/orders/${order.orderNumber}/cancel`)
      .set("Authorization", bearer(ada));
    expect(res.status).toBe(409);
  });

  it("can't cancel another customer's order", async () => {
    const order = await paidOrder({ auth: bearer(await createUser()) });
    const res = await request(ctx.app)
      .post(`/api/v1/orders/${order.orderNumber}/cancel`)
      .set("Authorization", bearer(await createUser()));
    expect(res.status).toBe(404);
  });
});

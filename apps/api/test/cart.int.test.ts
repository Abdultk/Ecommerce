import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Cart, envelope } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { PASSWORD, buildApp, cookieFrom, createUser, prisma, resetDb } from "./helpers";

const { app } = buildApp();
const cartEnvelope = envelope(Cart);

const variantId = async (sku: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { sku } })).id;

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
});

function parseCart(body: unknown) {
  const parsed = cartEnvelope.parse(body); // also enforces line and subtotal invariants
  if (!parsed.success) throw new Error("expected success");
  return parsed.data;
}

async function addItem(sku: string, quantity: number, cookie?: string, token?: string) {
  const req = request(app)
    .post("/api/v1/cart/items")
    .send({ variantId: await variantId(sku), quantity });
  if (cookie) req.set("Cookie", cookie);
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req;
}

describe("guest cart", () => {
  it("is empty without a cookie and does not create a row", async () => {
    const res = await request(app).get("/api/v1/cart");
    expect(parseCart(res.body).items).toEqual([]);
    expect(await prisma.cart.count()).toBe(0);
  });

  it("is created on first add and remembered with a signed httpOnly cookie", async () => {
    const res = await addItem("IV-SK10", 2);
    expect(res.status).toBe(200);
    const cart = parseCart(res.body);
    expect(cart.items).toHaveLength(1);
    expect(cart.totals.subtotalCents).toBe(37_000);

    const cookie = cookieFrom(res, "hp_cart")!;
    expect(cookie).toMatch(/^hp_cart=s%3A/); // signed
    const again = await request(app).get("/api/v1/cart").set("Cookie", cookie);
    expect(parseCart(again.body).id).toBe(cart.id);
  });

  it("merges quantities when the same variant is added twice", async () => {
    const cookie = cookieFrom(await addItem("IV-SK10", 1), "hp_cart")!;
    const res = await addItem("IV-SK10", 2, cookie);
    expect(parseCart(res.body).items[0]?.quantity).toBe(3);
  });

  it("refuses more than the available stock", async () => {
    const res = await addItem("IV-SK12", 9); // 8 in stock
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OUT_OF_STOCK", details: { available: 8 } });
  });

  it("returns 404 for unknown, inactive or unpublished items", async () => {
    const unknown = await request(app)
      .post("/api/v1/cart/items")
      .send({ variantId: "nope", quantity: 1 });
    expect(unknown.status).toBe(404);

    await prisma.product.update({ where: { slug: "chefs-knife-8in" }, data: { status: "DRAFT" } });
    expect((await addItem("BR-CK8", 1)).status).toBe(404);
  });

  it("updates and removes lines", async () => {
    const add = await addItem("IV-SK10", 1);
    const cookie = cookieFrom(add, "hp_cart")!;
    const lineId = parseCart(add.body).items[0]!.id;

    const patched = await request(app)
      .patch(`/api/v1/cart/items/${lineId}`)
      .set("Cookie", cookie)
      .send({ quantity: 4 });
    expect(parseCart(patched.body).items[0]?.quantity).toBe(4);

    const removed = await request(app).delete(`/api/v1/cart/items/${lineId}`).set("Cookie", cookie);
    expect(parseCart(removed.body).items).toEqual([]);
  });

  it("cannot touch another cart's lines", async () => {
    const mine = await addItem("IV-SK10", 1);
    const lineId = parseCart(mine.body).items[0]!.id;
    const otherCookie = cookieFrom(await addItem("BR-CK8", 1), "hp_cart")!;

    const res = await request(app)
      .patch(`/api/v1/cart/items/${lineId}`)
      .set("Cookie", otherCookie)
      .send({ quantity: 2 });
    expect(res.status).toBe(404);
  });

  it("ignores a tampered cookie", async () => {
    const cookie = cookieFrom(await addItem("IV-SK10", 1), "hp_cart")!;
    const tampered = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const res = await request(app).get("/api/v1/cart").set("Cookie", tampered);
    expect(parseCart(res.body).items).toEqual([]);
  });
});

describe("coupons", () => {
  beforeEach(async () => {
    await prisma.coupon.create({
      data: { code: "WELCOME10", type: "PERCENT", value: 10, minSubtotalCents: 20_000 },
    });
  });

  it("explains how much more to spend", async () => {
    const cookie = cookieFrom(await addItem("IV-SK10", 1), "hp_cart")!; // OMR 18.500
    const res = await request(app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie)
      .send({ code: "welcome10" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: "COUPON_INVALID",
      message: expect.stringMatching(/^Spend OMR\s1\.500 more to use this code\.$/),
    });
  });

  it("applies and removes a valid coupon", async () => {
    const cookie = cookieFrom(await addItem("IV-SK10", 2), "hp_cart")!; // OMR 37.000
    const applied = await request(app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie)
      .send({ code: "welcome10" });
    expect(applied.status).toBe(200);
    const cart = parseCart(applied.body);
    expect(cart.couponCode).toBe("WELCOME10");
    expect(cart.totals.discountCents).toBe(3_700);

    const removed = await request(app).delete("/api/v1/cart/coupon").set("Cookie", cookie);
    expect(parseCart(removed.body)).toMatchObject({
      couponCode: null,
      totals: { discountCents: 0 },
    });
  });

  it("rejects unknown codes", async () => {
    const cookie = cookieFrom(await addItem("IV-SK10", 2), "hp_cart")!;
    const res = await request(app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie)
      .send({ code: "FREEMONEY" });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe("That code isn't valid.");
  });

  it("drops a coupon that stops qualifying when the cart changes", async () => {
    const add = await addItem("IV-SK10", 2);
    const cookie = cookieFrom(add, "hp_cart")!;
    await request(app)
      .post("/api/v1/cart/coupon")
      .set("Cookie", cookie)
      .send({ code: "WELCOME10" });
    const lineId = parseCart(add.body).items[0]!.id;
    const res = await request(app)
      .patch(`/api/v1/cart/items/${lineId}`)
      .set("Cookie", cookie)
      .send({ quantity: 1 });
    expect(parseCart(res.body)).toMatchObject({ couponCode: null, totals: { discountCents: 0 } });
  });
});

describe("signed-in cart", () => {
  async function tokenFor(email: string) {
    await createUser({ email });
    const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
    return res.body.data.accessToken as string;
  }

  it("belongs to the user, not a cookie", async () => {
    const token = await tokenFor("cook@example.test");
    const res = await addItem("IV-SK10", 1, undefined, token);
    expect(cookieFrom(res, "hp_cart")).toBeUndefined();
    const again = await request(app).get("/api/v1/cart").set("Authorization", `Bearer ${token}`);
    expect(parseCart(again.body).items).toHaveLength(1);
  });

  it("merges the guest cart on login, capped by stock, and clears the guest cookie", async () => {
    const token = await tokenFor("cook@example.test");
    await addItem("IV-SK12", 5, undefined, token); // user has 5 of 8
    const guest = cookieFrom(await addItem("IV-SK12", 6), "hp_cart")!; // guest has 6
    await addItem("BR-CK8", 1, guest);

    const merged = await request(app)
      .post("/api/v1/cart/merge")
      .set("Cookie", guest)
      .set("Authorization", `Bearer ${token}`);
    expect(merged.status).toBe(200);
    const cart = parseCart(merged.body);
    const qty = Object.fromEntries(cart.items.map((i) => [i.sku, i.quantity]));
    expect(qty).toEqual({ "IV-SK12": 8, "BR-CK8": 1 });
    expect(cookieFrom(merged, "hp_cart")).toBe("hp_cart=");
    expect(await prisma.cart.count({ where: { userId: null } })).toBe(0);
  });

  it("requires sign-in to merge", async () => {
    expect((await request(app).post("/api/v1/cart/merge")).status).toBe(401);
  });
});

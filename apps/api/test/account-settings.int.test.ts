import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  OMAN_ADDRESS,
  PASSWORD,
  WEB,
  bearer,
  buildApp,
  cookieFrom,
  createUser,
  prisma,
  resetDb,
} from "./helpers";
import { seedCatalog } from "../prisma/seed";

let ctx = buildApp();

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** A real sign-in, so the access token carries a session and the refresh cookie exists. */
async function signIn(email: string, userAgent = CHROME_WINDOWS, password = PASSWORD) {
  const res = await request(ctx.app)
    .post("/api/v1/auth/login")
    .set("User-Agent", userAgent)
    .send({ email, password });
  expect(res.status).toBe(200);
  return {
    token: `Bearer ${res.body.data.accessToken as string}`,
    cookie: cookieFrom(res, "hp_refresh")!,
  };
}

const call = (
  method: "get" | "put" | "post" | "delete",
  path: string,
  as: string,
  body?: object,
) => {
  const req = request(ctx.app)[method](`/api/v1/me${path}`).set("Authorization", as);
  return body ? req.send(body) : req;
};

const refresh = (cookie: string) =>
  request(ctx.app).post("/api/v1/auth/refresh").set("Origin", WEB).set("Cookie", cookie);

let email: string;

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
  email = (await createUser({ email: "cook@example.test" })).email;
});

describe("/me/preferences", () => {
  it("starts with safe defaults: receipts yes, offers no, nothing preselected", async () => {
    const { token } = await signIn(email);
    const res = await call("get", "/preferences", token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      phone: null,
      marketingEmails: false,
      shippingUpdateEmails: true,
      preferredPayment: null,
      preferredShipping: null,
      updatedAt: null,
    });
  });

  it("saves only what was sent and keeps the rest", async () => {
    const { token } = await signIn(email);
    const first = await call("put", "/preferences", token, {
      phone: "9123 4567",
      marketingEmails: true,
    });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ phone: "+96891234567", marketingEmails: true });

    const second = await call("put", "/preferences", token, {
      preferredPayment: "bank_transfer",
      preferredShipping: "express",
    });
    expect(second.body.data).toMatchObject({
      phone: "+96891234567",
      marketingEmails: true,
      shippingUpdateEmails: true,
      preferredPayment: "bank_transfer",
      preferredShipping: "express",
    });
    expect((await call("get", "/preferences", token)).body.data.preferredPayment).toBe(
      "bank_transfer",
    );
  });

  it("clears a value with null, and a phone with an empty string", async () => {
    const { token } = await signIn(email);
    await call("put", "/preferences", token, { phone: "91234567", preferredPayment: "card" });
    const res = await call("put", "/preferences", token, { phone: "", preferredPayment: null });
    expect(res.body.data).toMatchObject({ phone: null, preferredPayment: null });
  });

  it("refuses a non-Omani phone, unknown fields and an empty update", async () => {
    const { token } = await signIn(email);
    expect((await call("put", "/preferences", token, { phone: "+14155550123" })).status).toBe(400);
    expect((await call("put", "/preferences", token, { role: "ADMIN" })).status).toBe(400);
    expect((await call("put", "/preferences", token, {})).status).toBe(400);
  });

  it("needs a signed-in customer", async () => {
    const res = await request(ctx.app).get("/api/v1/me/preferences");
    expect(res.status).toBe(401);
  });
});

describe("POST /me/password", () => {
  const NEW_PASSWORD = "a completely new passphrase";

  it("refuses a wrong current password and changes nothing", async () => {
    const { token } = await signIn(email);
    const res = await call("post", "/password", token, {
      currentPassword: "not the password",
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Your password is incorrect.");
    await signIn(email); // the old password still works
  });

  it("changes the password and signs out the other devices, but not this one", async () => {
    const phone = await signIn(email, SAFARI_IPHONE);
    const laptop = await signIn(email, CHROME_WINDOWS);

    const res = await call("post", "/password", laptop.token, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);

    expect((await refresh(phone.cookie)).status).toBe(401);
    expect((await refresh(laptop.cookie)).status).toBe(200);

    await signIn(email, CHROME_WINDOWS, NEW_PASSWORD);
    const old = await request(ctx.app)
      .post("/api/v1/auth/login")
      .send({ email, password: PASSWORD });
    expect(old.status).toBe(401);
  });

  it("won't reuse the current password or accept a short one", async () => {
    const { token } = await signIn(email);
    const reuse = { currentPassword: PASSWORD, newPassword: PASSWORD };
    expect((await call("post", "/password", token, reuse)).status).toBe(400);
    const short = { currentPassword: PASSWORD, newPassword: "short" };
    expect((await call("post", "/password", token, short)).status).toBe(400);
  });
});

describe("/me/sessions", () => {
  it("lists each signed-in device, this one first", async () => {
    await signIn(email, SAFARI_IPHONE);
    const laptop = await signIn(email, CHROME_WINDOWS);
    const res = await call("get", "/sessions", laptop.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ device: "Chrome on Windows", current: true });
    expect(res.body.data[1]).toMatchObject({ device: "Safari on iOS", current: false });
  });

  it("signs out one other device", async () => {
    const phone = await signIn(email, SAFARI_IPHONE);
    const laptop = await signIn(email, CHROME_WINDOWS);
    const list = (await call("get", "/sessions", laptop.token)).body.data as {
      id: string;
      current: boolean;
    }[];
    const other = list.find((s) => !s.current)!;

    expect((await call("delete", `/sessions/${other.id}`, laptop.token)).status).toBe(200);
    expect((await call("get", "/sessions", laptop.token)).body.data).toHaveLength(1);
    expect((await refresh(phone.cookie)).status).toBe(401);
  });

  it("won't sign out the device being used, and finds nothing for an unknown one", async () => {
    const laptop = await signIn(email);
    const [current] = (await call("get", "/sessions", laptop.token)).body.data as { id: string }[];
    expect((await call("delete", `/sessions/${current!.id}`, laptop.token)).status).toBe(409);
    expect((await call("delete", "/sessions/nope", laptop.token)).status).toBe(404);
  });

  it("signs out every other device in one go", async () => {
    await signIn(email, SAFARI_IPHONE);
    await signIn(email, SAFARI_IPHONE);
    const laptop = await signIn(email, CHROME_WINDOWS);
    expect((await call("post", "/sessions/revoke-others", laptop.token, {})).status).toBe(200);
    const left = (await call("get", "/sessions", laptop.token)).body.data;
    expect(left).toHaveLength(1);
    expect(left[0].current).toBe(true);
  });

  it("only ever shows or touches your own devices", async () => {
    const other = await createUser({ email: "someone@example.test" });
    const theirs = await signIn(other.email);
    const mine = await signIn(email);
    const [theirSession] = (await call("get", "/sessions", theirs.token)).body.data as {
      id: string;
    }[];
    expect((await call("delete", `/sessions/${theirSession!.id}`, mine.token)).status).toBe(404);
    expect((await call("get", "/sessions", mine.token)).body.data).toHaveLength(1);
  });
});

let orderSequence = 0;
async function placeOrder(userId: string, status: "PROCESSING" | "PAID" = "PAID") {
  orderSequence += 1;
  return prisma.order.create({
    data: {
      number: `HP-2026-9${String(orderSequence).padStart(5, "0")}`,
      email: "cook@example.test",
      userId,
      status,
      subtotalCents: 18_500,
      shippingCents: 2_000,
      taxCents: 925,
      totalCents: 21_425,
      shippingAddress: OMAN_ADDRESS,
      shippingMethod: "standard",
      paymentMethod: "CARD",
      items: {
        create: {
          variantId: (await prisma.productVariant.findFirstOrThrow()).id,
          productName: "Cast Iron Skillet",
          variantName: "10 inch",
          sku: "IV-SK10",
          unitPriceCents: 18_500,
          quantity: 1,
          lineTotalCents: 18_500,
        },
      },
    },
  });
}

describe("GET /me/export", () => {
  it("returns the customer's own data and nothing of anyone else's", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const other = await createUser({ email: "someone@example.test" });
    await placeOrder(user.id);
    await placeOrder(other.id);
    const { token } = await signIn(email);
    await call("post", "/addresses", token, OMAN_ADDRESS);
    await call("put", "/preferences", token, { marketingEmails: true });

    const res = await call("get", "/export", token);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.account).toMatchObject({ email, firstName: "Ada", lastName: "Cook" });
    expect(data.preferences.marketingEmails).toBe(true);
    expect(data.addresses).toHaveLength(1);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0].items[0]).toMatchObject({ sku: "IV-SK10", quantity: 1 });
    expect(JSON.stringify(data)).not.toContain("someone@example.test");
    expect(JSON.stringify(data)).not.toContain("passwordHash");
  });
});

describe("POST /me/delete", () => {
  it("needs the right password and the word DELETE", async () => {
    const { token } = await signIn(email);
    const wrongPassword = { password: "wrong", confirm: "DELETE" };
    expect((await call("post", "/delete", token, wrongPassword)).status).toBe(400);
    const wrongWord = { password: PASSWORD, confirm: "delete" };
    expect((await call("post", "/delete", token, wrongWord)).status).toBe(400);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("deletes the account and its data, keeps the orders, and ends the session", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const order = await placeOrder(user.id);
    const product = await prisma.product.findFirstOrThrow();
    await prisma.review.create({
      data: { productId: product.id, userId: user.id, rating: 5, title: "Great", body: "Loved it." },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { ratingAvg: 5, ratingCount: 1 },
    });
    const { token } = await signIn(email);
    await call("post", "/addresses", token, OMAN_ADDRESS);
    await call("put", "/preferences", token, { marketingEmails: true });

    const res = await call("post", "/delete", token, { password: PASSWORD, confirm: "DELETE" });
    expect(res.status).toBe(200);

    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(await prisma.address.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.customerPreferences.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.review.count({ where: { userId: user.id } })).toBe(0);
    const kept = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept.userId).toBeNull();
    expect(kept.email).toBe("cook@example.test");
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
      ratingCount: 0,
    });
    expect((await call("get", "", token)).status).toBe(401);
  });

  it("is not available to staff accounts", async () => {
    const admin = await createUser({ email: "boss@example.test", role: "ADMIN" });
    const res = await request(ctx.app)
      .post("/api/v1/me/delete")
      .set("Authorization", bearer(admin))
      .send({ password: PASSWORD, confirm: "DELETE" });
    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { email: "boss@example.test" } })).toBe(1);
  });
});

describe("the shipping email preference", () => {
  async function ship(userId: string) {
    const admin = await createUser({ email: "boss@example.test", role: "ADMIN" });
    const order = await placeOrder(userId, "PROCESSING");
    const res = await request(ctx.app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set("Authorization", bearer(admin))
      .send({ status: "SHIPPED", trackingNumber: "TRK123" });
    expect(res.status).toBe(200);
  }
  const shippedMails = () => ctx.mailer.outbox.filter((m) => /has shipped/.test(m.subject));

  it("sends the shipped email by default", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await ship(user.id);
    expect(shippedMails()).toHaveLength(1);
  });

  it("skips it when the customer turned it off", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.customerPreferences.create({
      data: { userId: user.id, shippingUpdateEmails: false },
    });
    await ship(user.id);
    expect(shippedMails()).toHaveLength(0);
  });
});

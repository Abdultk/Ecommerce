import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { CheckoutIntent, OrderDetail, PublicStoreConfig, envelope } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { releaseExpiredReservations } from "../src/modules/orders/orders.service";
import {
  OMAN_ADDRESS,
  TEST_TOTP_SECRET,
  bearer,
  buildApp,
  cookieFrom,
  createUser,
  prisma,
  resetDb,
} from "./helpers";

let ctx = buildApp();

// Test fixtures only: the real methods are whatever the store admin adds in Settings.
const cod = {
  id: "cash-on-delivery",
  label: "Cash on delivery",
  instructions: "Pay the courier in cash when your order arrives.",
  enabled: true,
};
const wallet = {
  id: "wallet",
  label: "Mobile wallet",
  instructions: "Send the amount to the wallet shown on our contact page.",
  enabled: false,
};

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
});

const setMethods = (manualMethods: object[], extra: object = {}) =>
  prisma.storeSettings.upsert({
    where: { id: "default" },
    create: { id: "default", manualMethods, ...extra },
    update: { manualMethods, ...extra },
  });

async function guestCart() {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
  const res = await request(ctx.app)
    .post("/api/v1/cart/items")
    .send({ variantId: variant.id, quantity: 1 });
  expect(res.status).toBe(200);
  return cookieFrom(res, "hp_cart")!;
}

const checkout = (cookie: string, overrides: object = {}) =>
  request(ctx.app)
    .post("/api/v1/checkout/intent")
    .set("Cookie", cookie)
    .send({
      email: "ada@example.test",
      shippingAddress: OMAN_ADDRESS,
      shippingMethod: "standard",
      paymentMethod: "manual",
      manualMethodId: cod.id,
      ...overrides,
    });

describe("GET /store", () => {
  it("lists only enabled admin-defined methods, with their instructions", async () => {
    await setMethods([cod, wallet]);
    const res = await request(ctx.app).get("/api/v1/store");
    const body = envelope(PublicStoreConfig).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.paymentMethods).toContain("manual");
    expect(body.data.manualMethods).toEqual([
      { id: cod.id, label: cod.label, instructions: cod.instructions },
    ]);
  });

  it("offers no manual method when every one is switched off", async () => {
    await setMethods([{ ...cod, enabled: false }]);
    const body = (await request(ctx.app).get("/api/v1/store")).body.data;
    expect(body.paymentMethods).not.toContain("manual");
    expect(body.manualMethods).toEqual([]);
  });
});

describe("checkout with an admin-defined method", () => {
  it("holds stock, snapshots the instructions and emails them", async () => {
    await setMethods([cod]);
    const res = await checkout(await guestCart());
    expect(res.status).toBe(201);
    const body = envelope(CheckoutIntent).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.payment).toMatchObject({
      kind: "manual",
      label: cod.label,
      instructions: cod.instructions,
      reference: body.data.orderNumber,
      amountCents: body.data.totals.totalCents,
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: body.data.orderNumber },
    });
    expect(order).toMatchObject({ paymentMethod: "MANUAL", paymentProvider: "manual" });
    expect(order.manualPayment).toEqual({
      id: cod.id,
      label: cod.label,
      instructions: cod.instructions,
    });
    expect(ctx.mailer.outbox.at(-1)?.text).toContain(cod.instructions);

    // Editing the method later never changes what this customer was told.
    await setMethods([{ ...cod, instructions: "Changed." }]);
    const detail = await request(ctx.app)
      .post("/api/v1/orders/lookup")
      .send({ number: body.data.orderNumber, token: body.data.lookupToken });
    const view = envelope(OrderDetail).parse(detail.body);
    if (!view.success) throw new Error("expected success");
    expect(view.data).toMatchObject({ paymentMethod: "manual", paymentLabel: cod.label });
    expect(view.data.manualPayment?.instructions).toBe(cod.instructions);
  });

  it.each([
    ["a method that is switched off", { manualMethodId: wallet.id }],
    ["an unknown method", { manualMethodId: "nope" }],
    ["no method id at all", { manualMethodId: undefined }],
  ])("refuses %s", async (_name, overrides) => {
    await setMethods([cod, wallet]);
    const res = await checkout(await guestCart(), overrides);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    expect(await prisma.order.count()).toBe(0);
  });

  it("refuses manual payment when the admin has none enabled", async () => {
    await setMethods([]);
    const res = await checkout(await guestCart());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });

  it("is cancelled and the stock released when the payment doesn't arrive in time", async () => {
    await setMethods([cod], { bankTransferHoldHours: 1 });
    const res = await checkout(await guestCart());
    const number = res.body.data.orderNumber as string;
    const later = new Date(Date.now() + 2 * 3_600_000);
    const deps = { db: prisma, payments: ctx.payments, mailer: ctx.mailer };
    expect(await releaseExpiredReservations(deps, later)).toBe(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { number } });
    expect(order.status).toBe("CANCELLED");
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockReserved).toBe(0);
    expect(ctx.mailer.outbox.at(-1)?.text).toContain("payment");
  });
});

describe("admin", () => {
  it("confirms a manual payment by hand, like a bank transfer", async () => {
    await setMethods([cod]);
    const res = await checkout(await guestCart());
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: res.body.data.orderNumber },
    });
    const admin = bearer(await createUser({ role: "SUPER_ADMIN" }));
    const confirm = await request(ctx.app)
      .post(`/api/v1/admin/orders/${order.id}/confirm-transfer`)
      .set("Authorization", admin)
      .set("Idempotency-Key", "confirm-1")
      .send({ receivedCents: order.totalCents, bankReference: "COD-RECEIPT-1" });
    expect(confirm.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
  });

  it("saves methods only with a fresh 2FA code, and keeps one method enabled", async () => {
    const admin = bearer(await createUser({ role: "SUPER_ADMIN" }));
    const patch = (body: object) =>
      request(ctx.app)
        .patch("/api/v1/admin/settings/payments")
        .set("Authorization", admin)
        .send(body);

    expect((await patch({ manualMethods: [cod] })).status).toBe(400);

    // Nothing else is enabled, so switching the whole list off is refused before any 2FA check.
    const none = await patch({
      cardEnabled: false,
      bankTransferEnabled: false,
      manualMethods: [{ ...cod, enabled: false }],
      totpCode: "000000",
    });
    expect(none.status).toBe(400);

    const saved = await patch({
      manualMethods: [cod, wallet],
      totpCode: authenticator.generate(TEST_TOTP_SECRET),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.payments.manualMethods).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import type { Role } from "@prisma/client";
import {
  AdminOrderDetail,
  AdminProductDetail,
  AdminProductListItem,
  AdminUserListItem,
  AuditLogEntry,
  CouponView,
  InventoryItem,
  PresignResult,
  StockMovementView,
  envelope,
} from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import {
  OMAN_ADDRESS,
  CDN,
  bearer,
  buildApp,
  cookieFrom,
  createUser,
  prisma,
  resetDb,
  tokenFromEmail,
} from "./helpers";

let ctx = buildApp();
const tokens: Partial<Record<Role, string>> = {};

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
  for (const role of ["STAFF", "ADMIN", "SUPER_ADMIN"] as const) {
    tokens[role] = bearer(await createUser({ role, email: `${role.toLowerCase()}@example.test` }));
  }
});

const as = (role: Role) => tokens[role]!;
const api = {
  get: (path: string, role: Role = "ADMIN") =>
    request(ctx.app).get(`/api/v1/admin${path}`).set("Authorization", as(role)),
  post: (path: string, body: object, role: Role = "ADMIN") =>
    request(ctx.app).post(`/api/v1/admin${path}`).set("Authorization", as(role)).send(body),
  patch: (path: string, body: object, role: Role = "ADMIN") =>
    request(ctx.app).patch(`/api/v1/admin${path}`).set("Authorization", as(role)).send(body),
  delete: (path: string, role: Role = "ADMIN") =>
    request(ctx.app).delete(`/api/v1/admin${path}`).set("Authorization", as(role)),
};

const auditActions = async () =>
  (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);

async function paidOrder() {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
  const added = await request(ctx.app)
    .post("/api/v1/cart/items")
    .send({ variantId: variant.id, quantity: 2 });
  const intent = await request(ctx.app)
    .post("/api/v1/checkout/intent")
    .set("Cookie", cookieFrom(added, "hp_cart")!)
    .send({
      email: "ada@example.test",
      shippingAddress: OMAN_ADDRESS,
      shippingMethod: "standard",
      paymentMethod: "card",
    });
  await request(ctx.app)
    .post("/api/v1/checkout/fake-confirm")
    .send({ orderNumber: intent.body.data.orderNumber });
  return prisma.order.findUniqueOrThrow({ where: { number: intent.body.data.orderNumber } });
}

const newProduct = async (overrides: object = {}) => ({
  name: "Carbon Steel Wok",
  slug: "carbon-steel-wok",
  categoryId: (await prisma.category.findFirstOrThrow()).id,
  description: '<p>Seasoned.</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
  status: "DRAFT",
  variants: [{ sku: "CS-WOK14", name: "14 in", priceCents: 5_900, initialStock: 12 }],
  ...overrides,
});

describe("permissions", () => {
  it("lets staff manage products but not refunds, coupons, users or the audit log", async () => {
    expect((await api.get("/products", "STAFF")).status).toBe(200);
    expect((await api.get("/coupons", "STAFF")).status).toBe(403);
    expect((await api.get("/users", "STAFF")).status).toBe(403);
    expect((await api.get("/audit-log", "STAFF")).status).toBe(403);
    expect((await api.post("/orders/x/refund", { amountCents: 100 }, "STAFF")).status).toBe(403);
  });

  it("keeps user changes and the audit log for super admins", async () => {
    expect((await api.get("/users", "ADMIN")).status).toBe(200);
    expect((await api.patch("/users/x", { disabled: true }, "ADMIN")).status).toBe(403);
    expect((await api.get("/audit-log", "ADMIN")).status).toBe(403);
    expect((await api.get("/audit-log", "SUPER_ADMIN")).status).toBe(200);
  });
});

describe("/admin/products", () => {
  it("creates a product with sanitized HTML, initial stock in the ledger and an audit entry", async () => {
    const res = await api.post("/products", await newProduct());
    expect(res.status).toBe(201);
    const body = envelope(AdminProductDetail).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.description).not.toContain("script");
    expect(body.data.description).not.toContain("javascript:");
    expect(body.data.variants[0]).toMatchObject({ sku: "CS-WOK14", stockOnHand: 12 });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { variantId: body.data.variants[0]!.id },
    });
    expect(movement).toMatchObject({ delta: 12, reason: "RESTOCK" });
    expect(await auditActions()).toEqual(["product.create"]);
  });

  it("refuses a duplicate slug or SKU with a clear message", async () => {
    await api.post("/products", await newProduct());
    const slug = await api.post(
      "/products",
      await newProduct({ variants: [{ sku: "OTHER-1", name: "x", priceCents: 100 }] }),
    );
    expect(slug.status).toBe(409);
    expect(slug.body.error.message).toMatch(/slug/);
    const sku = await api.post("/products", await newProduct({ slug: "another-wok" }));
    expect(sku.status).toBe(409);
    expect(sku.body.error.message).toMatch(/CS-WOK14/);
  });

  it("refuses stock set through the product form", async () => {
    const res = await api.post(
      "/products",
      await newProduct({
        variants: [{ sku: "CS-1", name: "x", priceCents: 100, stockOnHand: 50 }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("updates fields and variants, and adds new variants", async () => {
    const created = (await api.post("/products", await newProduct())).body
      .data as AdminProductDetail;
    const res = await api.patch(`/products/${created.id}`, {
      name: "Hand-Hammered Wok",
      variants: [
        { id: created.variants[0]!.id, priceCents: 6_400 },
        { sku: "CS-WOK16", name: "16 in", priceCents: 7_400 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Hand-Hammered Wok");
    const variants = res.body.data.variants as { sku: string; priceCents: number }[];
    expect(variants.map((v) => [v.sku, v.priceCents])).toEqual([
      ["CS-WOK14", 6_400],
      ["CS-WOK16", 7_400],
    ]);
  });

  it("refuses to patch a variant from another product", async () => {
    const created = (await api.post("/products", await newProduct())).body
      .data as AdminProductDetail;
    const foreign = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    const res = await api.patch(`/products/${created.id}`, {
      variants: [{ id: foreign.id, priceCents: 1 }],
    });
    expect(res.status).toBe(404);
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(after.priceCents).toBe(foreign.priceCents);
  });

  it("lists with filters and sorting across the whole table", async () => {
    const res = await api.get("/products?sort=price&dir=asc&pageSize=3");
    const body = envelope(z.array(AdminProductListItem)).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.meta?.total).toBe(8);
    const prices = body.data.map((p) => p.fromPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const search = await api.get("/products?q=IV-SK10");
    expect(search.body.data).toHaveLength(1);
  });

  it("archives instead of deleting (admins only)", async () => {
    const product = await prisma.product.findFirstOrThrow();
    expect((await api.delete(`/products/${product.id}`, "STAFF")).status).toBe(403);
    const res = await api.delete(`/products/${product.id}`);
    expect(res.body.data.status).toBe("ARCHIVED");
  });

  it("presigns image uploads with a server-chosen key", async () => {
    const res = await api.post("/uploads/presign", {
      contentType: "image/webp",
      contentLength: 50_000,
    });
    const body = envelope(PresignResult).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.publicUrl).toBe(`${CDN}/${body.data.key}`);
    const svg = await api.post("/uploads/presign", {
      contentType: "image/svg+xml",
      contentLength: 10,
    });
    expect(svg.status).toBe(400);
  });
});

describe("/admin/categories", () => {
  it("creates and deletes categories, refusing cycles and non-empty deletes", async () => {
    const parent = await api.post("/categories", { name: "Bakeware X", slug: "bakeware-x" });
    expect(parent.status).toBe(201);
    const child = await api.post("/categories", {
      name: "Tins",
      slug: "tins",
      parentId: parent.body.data.id,
    });
    const cycle = await api.patch(`/categories/${parent.body.data.id}`, {
      name: "Bakeware X",
      slug: "bakeware-x",
      parentId: child.body.data.id,
    });
    expect(cycle.status).toBe(400);
    expect((await api.delete(`/categories/${parent.body.data.id}`)).status).toBe(409);
    expect((await api.delete(`/categories/${child.body.data.id}`)).status).toBe(200);
  });
});

describe("/admin/orders", () => {
  it("lists and shows orders with the allowed next steps", async () => {
    const order = await paidOrder();
    const list = await api.get("/orders?status=PAID&q=ada");
    expect(list.body.data.map((o: { number: string }) => o.number)).toEqual([order.number]);

    const detail = envelope(AdminOrderDetail).parse((await api.get(`/orders/${order.id}`)).body);
    expect(detail.success && detail.data).toMatchObject({
      allowedStatuses: ["PROCESSING"],
      canCancel: true,
      refundableCents: order.totalCents,
    });
  });

  it("moves an order through fulfilment and emails tracking when shipped", async () => {
    const order = await paidOrder();
    const status = (body: object) => api.patch(`/orders/${order.id}/status`, body, "STAFF");
    expect((await status({ status: "SHIPPED", trackingNumber: "1Z" })).status).toBe(409);
    expect((await status({ status: "PROCESSING" })).status).toBe(200);
    expect((await status({ status: "SHIPPED" })).status).toBe(400); // tracking number required
    const shipped = await status({ status: "SHIPPED", trackingNumber: "1Z999" });
    expect(shipped.body.data.order).toMatchObject({ status: "SHIPPED", trackingNumber: "1Z999" });
    expect(ctx.mailer.outbox.at(-1)?.text).toContain("1Z999");
    expect(await auditActions()).toEqual(["order.status", "order.status"]);
  });

  it("records the courier and expected delivery date, and emails them", async () => {
    const order = await paidOrder();
    const status = (body: object) => api.patch(`/orders/${order.id}/status`, body, "STAFF");
    await status({ status: "PROCESSING" });
    const shipped = await status({
      status: "SHIPPED",
      trackingNumber: "1Z999",
      carrier: "Aramex",
      expectedDeliveryDate: "2026-10-28",
    });
    expect(shipped.body.data.order).toMatchObject({
      carrier: "Aramex",
      estimatedDeliveryAt: "2026-10-28T12:00:00.000Z",
    });
    const mail = ctx.mailer.outbox.at(-1)?.text ?? "";
    expect(mail).toContain("Carrier: Aramex");
    expect(mail).toContain("Expected delivery: 2026-10-28");

    const receipt = ctx.mailer.outbox.find((m) => /receipt for order/.test(m.subject))?.text ?? "";
    expect(receipt).toContain(`Order: ${order.number}`);
    expect(receipt).toContain("Delivering to:");
    expect(receipt).toContain("Total:");

    await status({ status: "DELIVERED" });
    const delivered = ctx.mailer.outbox.at(-1);
    expect(delivered?.subject).toMatch(/was delivered/);
    expect(delivered?.text).toContain("with Aramex");
  });

  it("refunds part of an order, then the rest, ending REFUNDED", async () => {
    const order = await paidOrder();
    const partial = await api.post(`/orders/${order.id}/refund`, {
      amountCents: 1_000,
      reason: "Dented lid",
    });
    expect(partial.body.data.order).toMatchObject({
      status: "PAID",
      refundState: "PARTIAL",
      refundedCents: 1_000,
    });
    expect(partial.body.data.refunds[0]).toMatchObject({
      amountCents: 1_000,
      actorEmail: "admin@example.test",
    });

    const tooMuch = await api.post(`/orders/${order.id}/refund`, { amountCents: order.totalCents });
    expect(tooMuch.status).toBe(400);

    const rest = await api.post(`/orders/${order.id}/refund`, {
      amountCents: order.totalCents - 1_000,
    });
    expect(rest.body.data.order).toMatchObject({ status: "REFUNDED", refundState: "FULL" });
    expect(rest.body.data.refundableCents).toBe(0);
  });

  it("doesn't let staff without the refund permission cancel a paid order", async () => {
    const order = await paidOrder();
    const res = await api.post(`/orders/${order.id}/cancel`, {}, "STAFF");
    expect(res.status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(ctx.payments.intents.get(order.providerPaymentId!)?.refundedCents).toBe(0);
  });

  it("cancels a paid order with a full refund and restock", async () => {
    const order = await paidOrder();
    const res = await api.post(`/orders/${order.id}/cancel`, { reason: "Customer request" });
    expect(res.body.data.order).toMatchObject({ status: "CANCELLED", refundState: "FULL" });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    expect(variant.stockOnHand).toBe(24);
    expect(await auditActions()).toEqual(["order.cancel"]);
  });
});

describe("/admin/inventory", () => {
  it("adjusts stock through the ledger and refuses to go below reserved stock", async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: "IV-SK10" } });
    const adjust = (body: object) => api.post("/inventory/adjust", body, "STAFF");
    const res = await adjust({
      variantId: variant.id,
      delta: -4,
      reason: "DAMAGE",
      note: "Dropped",
    });
    const body = envelope(InventoryItem).parse(res.body);
    expect(body.success && body.data.stockOnHand).toBe(20);

    await prisma.productVariant.update({ where: { id: variant.id }, data: { stockReserved: 5 } });
    expect((await adjust({ variantId: variant.id, delta: -16, reason: "CORRECTION" })).status).toBe(
      400,
    );

    const movements = envelope(z.array(StockMovementView)).parse(
      (await api.get(`/inventory/${variant.id}/movements`, "STAFF")).body,
    );
    expect(movements.success && movements.data[0]).toMatchObject({
      delta: -4,
      reason: "DAMAGE",
      actorEmail: "staff@example.test",
    });
    expect(await auditActions()).toEqual(["inventory.adjust"]);
  });

  it("never lets admins record a SALE", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow();
    const res = await api.post("/inventory/adjust", {
      variantId: variant.id,
      delta: -1,
      reason: "SALE",
    });
    expect(res.status).toBe(400);
  });

  it("lists low-stock variants", async () => {
    await prisma.productVariant.update({ where: { sku: "IV-SK10" }, data: { stockOnHand: 2 } });
    const body = envelope(z.array(InventoryItem)).parse(
      (await api.get("/inventory?lowStock=true", "STAFF")).body,
    );
    if (!body.success) throw new Error("expected success");
    expect(body.data.map((i) => i.sku)).toContain("IV-SK10");
    expect(body.data.every((i) => i.lowStock)).toBe(true);
  });
});

describe("/admin/coupons", () => {
  const coupon = { code: "summer15", type: "PERCENT", value: 15 };

  it("creates (upper-cased), edits and deletes an unused coupon", async () => {
    const created = await api.post("/coupons", coupon);
    const body = envelope(CouponView).parse(created.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.code).toBe("SUMMER15");
    expect((await api.post("/coupons", coupon)).status).toBe(409);

    const edited = await api.patch(`/coupons/${body.data.id}`, { ...coupon, value: 20 });
    expect(edited.body.data.value).toBe(20);
    const deleted = await api.delete(`/coupons/${body.data.id}`);
    expect(deleted.body.data).toEqual({ deleted: true, deactivated: false });
  });

  it("deactivates a coupon that has been used instead of deleting it", async () => {
    const created = await api.post("/coupons", coupon);
    const id = created.body.data.id as string;
    await prisma.coupon.update({ where: { id }, data: { redemptions: 3 } });
    expect((await api.delete(`/coupons/${id}`)).body.data).toEqual({
      deleted: false,
      deactivated: true,
    });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);
  });

  it("rejects an invalid percentage", async () => {
    expect((await api.post("/coupons", { ...coupon, value: 150 })).status).toBe(400);
  });
});

describe("/admin/users", () => {
  it("lists users by role", async () => {
    const body = envelope(z.array(AdminUserListItem)).parse(
      (await api.get("/users?role=STAFF")).body,
    );
    expect(body.success && body.data.map((u) => u.email)).toEqual(["staff@example.test"]);
  });

  it("invites staff by email; the link leads to 2FA enrollment", async () => {
    const res = await api.post(
      "/users/invite",
      { email: "new@example.test", firstName: "New", lastName: "Hire", role: "STAFF" },
      "SUPER_ADMIN",
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: "STAFF", twoFactorEnabled: false });
    const mail = ctx.mailer.outbox.at(-1)!;
    expect(mail.to).toBe("new@example.test");
    const accepted = await request(ctx.app)
      .post("/api/v1/admin/auth/accept-invite")
      .send({ token: tokenFromEmail(mail.text), password: "a brand new long password" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.enrollmentRequired).toBe(true);
  });

  it("disables a customer and records it", async () => {
    const customer = await createUser({ email: "shopper@example.test" });
    const res = await api.patch(`/users/${customer.id}`, { disabled: true }, "SUPER_ADMIN");
    expect(res.body.data.disabled).toBe(true);
    expect(await auditActions()).toEqual(["user.update"]);
  });

  it("refuses changes to your own account", async () => {
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: "super_admin@example.test" },
    });
    expect((await api.patch(`/users/${me.id}`, { role: "ADMIN" }, "SUPER_ADMIN")).status).toBe(403);
    expect((await api.post(`/users/${me.id}/invite`, {}, "SUPER_ADMIN")).status).toBe(403);
  });

  it("can demote another super admin while one remains", async () => {
    const other = await createUser({ email: "other-boss@example.test", role: "SUPER_ADMIN" });
    const res = await api.patch(`/users/${other.id}`, { role: "ADMIN" }, "SUPER_ADMIN");
    expect(res.body.data.role).toBe("ADMIN");
  });
});

describe("/admin/audit-log", () => {
  it("records who changed what, without secrets", async () => {
    await api.post("/products", await newProduct());
    const body = envelope(z.array(AuditLogEntry)).parse(
      (await api.get("/audit-log?entity=Product", "SUPER_ADMIN")).body,
    );
    if (!body.success) throw new Error("expected success");
    expect(body.data[0]).toMatchObject({
      action: "product.create",
      actorEmail: "admin@example.test",
    });
    expect(JSON.stringify(body.data)).not.toMatch(/passwordHash|totpSecret/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { Address, ProductSummary, Review, WishlistItem, envelope } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import { OMAN_ADDRESS, bearer, buildApp, createUser, prisma, resetDb } from "./helpers";

let ctx = buildApp();
let auth: string;

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
  auth = bearer(await createUser());
});

const api = {
  get: (path: string, as = auth) => request(ctx.app).get(`/api/v1${path}`).set("Authorization", as),
  post: (path: string, body: object, as = auth) =>
    request(ctx.app).post(`/api/v1${path}`).set("Authorization", as).send(body),
  patch: (path: string, body: object, as = auth) =>
    request(ctx.app).patch(`/api/v1${path}`).set("Authorization", as).send(body),
  delete: (path: string, as = auth) =>
    request(ctx.app).delete(`/api/v1${path}`).set("Authorization", as),
};

describe("PATCH /me", () => {
  it("updates the name", async () => {
    const res = await api.patch("/me", { firstName: "Grace" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: "Grace", lastName: "Cook" });
  });

  it("refuses fields it doesn't allow, such as role or email", async () => {
    expect((await api.patch("/me", { role: "SUPER_ADMIN" })).status).toBe(400);
    expect((await api.patch("/me", { email: "x@example.test" })).status).toBe(400);
  });
});

describe("/me/addresses", () => {
  it("creates, lists, updates and deletes addresses", async () => {
    const created = await api.post("/me/addresses", OMAN_ADDRESS);
    expect(created.status).toBe(201);
    const address = envelope(Address).parse(created.body);
    if (!address.success) throw new Error("expected success");
    expect(address.data.isDefault).toBe(true); // the first address becomes the default

    const updated = await api.patch(`/me/addresses/${address.data.id}`, {
      ...OMAN_ADDRESS,
      city: "Oakland",
    });
    expect(updated.body.data.city).toBe("Oakland");

    const list = envelope(z.array(Address)).parse((await api.get("/me/addresses")).body);
    expect(list.success && list.data).toHaveLength(1);

    expect((await api.delete(`/me/addresses/${address.data.id}`)).status).toBe(200);
    expect((await api.get("/me/addresses")).body.data).toEqual([]);
  });

  it("keeps exactly one default", async () => {
    await api.post("/me/addresses", OMAN_ADDRESS);
    const second = await api.post("/me/addresses", {
      ...OMAN_ADDRESS,
      line1: "2 Main St",
      isDefault: true,
    });
    const list = (await api.get("/me/addresses")).body.data as Address[];
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.body.data.id]);
  });

  it("refuses non-US addresses", async () => {
    expect((await api.post("/me/addresses", { ...OMAN_ADDRESS, country: "CA" })).status).toBe(400);
  });

  it("can't read or change another customer's address", async () => {
    const created = await api.post("/me/addresses", OMAN_ADDRESS);
    const other = bearer(await createUser());
    expect(
      (await api.patch(`/me/addresses/${created.body.data.id}`, OMAN_ADDRESS, other)).status,
    ).toBe(404);
    expect((await api.delete(`/me/addresses/${created.body.data.id}`, other)).status).toBe(404);
  });
});

describe("/me/wishlist", () => {
  it("adds (idempotently), lists and removes products", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { status: "ACTIVE" } });
    expect((await api.post("/me/wishlist", { productId: product.id })).status).toBe(201);
    expect((await api.post("/me/wishlist", { productId: product.id })).status).toBe(201);

    const list = envelope(z.array(WishlistItem)).parse((await api.get("/me/wishlist")).body);
    expect(list.success && list.data.map((i) => i.productId)).toEqual([product.id]);

    expect((await api.delete(`/me/wishlist/${product.id}`)).status).toBe(200);
    expect((await api.get("/me/wishlist")).body.data).toEqual([]);
  });

  it("404s for an unknown product", async () => {
    expect((await api.post("/me/wishlist", { productId: "c".repeat(25) })).status).toBe(404);
  });

  it("returns saved products as summaries, newest first, skipping archived ones", async () => {
    const [first, second, archived] = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { id: "asc" },
      take: 3,
    });
    for (const p of [first!, second!, archived!]) {
      expect((await api.post("/me/wishlist", { productId: p.id })).status).toBe(201);
    }
    await prisma.product.update({ where: { id: archived!.id }, data: { status: "ARCHIVED" } });

    const res = await api.get("/me/wishlist/products");
    const body = envelope(z.array(ProductSummary)).parse(res.body);
    expect(body.success && body.data.map((p) => p.id)).toEqual([second!.id, first!.id]);
    expect(body.success && body.data[0]?.slug).toBe(second!.slug);
  });
});

describe("product reviews", () => {
  const review = { rating: 4, title: "Great pan", body: "Heats evenly and cleans up easily." };

  async function buy(as: string, sku = "IV-SK10") {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku },
      include: { product: true },
    });
    await api.post("/cart/items", { variantId: variant.id, quantity: 1 }, as);
    const intent = await api.post(
      "/checkout/intent",
      {
        email: "ada@example.test",
        shippingAddress: OMAN_ADDRESS,
        shippingMethod: "standard",
        paymentMethod: "card",
      },
      as,
    );
    await request(ctx.app)
      .post("/api/v1/checkout/fake-confirm")
      .send({ orderNumber: intent.body.data.orderNumber });
    return variant.product.slug;
  }

  it("only accepts reviews from customers who bought the product", async () => {
    const slug = (
      await prisma.productVariant.findUniqueOrThrow({
        where: { sku: "IV-SK10" },
        include: { product: true },
      })
    ).product.slug;
    const res = await api.post(`/products/${slug}/reviews`, review);
    expect(res.status).toBe(403);
  });

  it("publishes a verified review and updates the product rating", async () => {
    const slug = await buy(auth);
    const res = await api.post(`/products/${slug}/reviews`, review);
    expect(res.status).toBe(201);
    expect(envelope(Review).parse(res.body).success && res.body.data.verifiedPurchase).toBe(true);

    const other = bearer(await createUser());
    await buy(other);
    await api.post(`/products/${slug}/reviews`, { ...review, rating: 2 }, other);

    const product = await prisma.product.findUniqueOrThrow({ where: { slug } });
    expect(Number(product.ratingAvg)).toBe(3);
    expect(product.ratingCount).toBe(2);

    const list = await request(ctx.app).get(`/api/v1/products/${slug}/reviews`);
    const body = envelope(z.array(Review)).parse(list.body);
    expect(body.success && body.data).toHaveLength(2);
    expect(body.success && body.meta?.total).toBe(2);
  });

  it("allows one review per product per customer", async () => {
    const slug = await buy(auth);
    await api.post(`/products/${slug}/reviews`, review);
    expect((await api.post(`/products/${slug}/reviews`, review)).status).toBe(409);
  });

  it("doesn't count a cancelled purchase", async () => {
    const slug = await buy(auth);
    const [order] = await prisma.order.findMany();
    await api.post(`/orders/${order!.number}/cancel`, {});
    expect((await api.post(`/products/${slug}/reviews`, review)).status).toBe(403);
  });
});

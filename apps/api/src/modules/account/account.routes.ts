import { Router } from "express";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { z } from "zod";
import type { Address as AddressRow } from "@prisma/client";
import { AddressInput, Id, ProfileUpdate, ok, type Address } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { toPublicUser } from "../auth/session";
import { productSummariesByIds } from "../catalog/search.repository";
import { accountSettingsRouter } from "./settings.routes";

const MAX_ADDRESSES = 20;
const MAX_WISHLIST_PRODUCTS = 200;
const WishlistInput = z.object({ productId: Id });

const toAddress = (a: AddressRow): Address => ({
  id: a.id,
  fullName: a.fullName,
  line1: a.line1,
  ...(a.line2 ? { line2: a.line2 } : {}),
  city: a.city,
  region: a.region,
  ...(a.postalCode ? { postalCode: a.postalCode } : {}),
  country: a.country,
  ...(a.phone ? { phone: a.phone } : {}),
  isDefault: a.isDefault,
});

const addressData = (input: AddressInput) => ({
  fullName: input.fullName,
  line1: input.line1,
  line2: input.line2 ?? null,
  city: input.city,
  region: input.region,
  postalCode: input.postalCode ?? null,
  country: input.country,
  phone: input.phone,
});

/** /me: profile, address book, wishlist and settings for the signed-in customer. */
export function accountRouter(deps: { limiter: RateLimiterAbstract }): Router {
  const router = Router();
  router.use(authenticate);
  router.use(accountSettingsRouter({ limiter: deps.limiter }));

  router.get("/", async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user || user.disabledAt) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    res.json(ok(toPublicUser(user)));
  });

  // Only names: email changes need re-verification and roles are admin-only.
  router.patch("/", async (req, res) => {
    const input = ProfileUpdate.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.sub }, data: input });
    res.json(ok(toPublicUser(user)));
  });

  // ---------- Addresses ----------

  const ownAddress = async (id: string, userId: string) => {
    const address = await prisma.address.findFirst({ where: { id, userId } });
    if (!address) throw new AppError("NOT_FOUND", "Address not found.");
    return address;
  };

  router.get("/addresses", async (req, res) => {
    const rows = await prisma.address.findMany({
      where: { userId: req.user!.sub },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });
    res.json(ok(rows.map(toAddress)));
  });

  router.post("/addresses", async (req, res) => {
    const input = AddressInput.parse(req.body);
    const userId = req.user!.sub;
    const created = await prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new AppError("VALIDATION_ERROR", `You can save up to ${MAX_ADDRESSES} addresses.`);
      }
      const isDefault = input.isDefault || count === 0;
      if (isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...addressData(input), userId, isDefault } });
    });
    res.status(201).json(ok(toAddress(created)));
  });

  router.patch("/addresses/:id", async (req, res) => {
    const input = AddressInput.parse(req.body);
    const userId = req.user!.sub;
    const existing = await ownAddress(req.params.id, userId);
    const updated = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({
        where: { id: existing.id },
        data: { ...addressData(input), isDefault: input.isDefault || existing.isDefault },
      });
    });
    res.json(ok(toAddress(updated)));
  });

  router.delete("/addresses/:id", async (req, res) => {
    const userId = req.user!.sub;
    const existing = await ownAddress(req.params.id, userId);
    await prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: existing.id } });
      if (!existing.isDefault) return;
      // Promote another address so there is still a default.
      const next = await tx.address.findFirst({ where: { userId }, orderBy: { id: "asc" } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    });
    res.json(ok({ deleted: true }));
  });

  // ---------- Wishlist ----------

  router.get("/wishlist", async (req, res) => {
    const items = await prisma.wishlistItem.findMany({
      where: { userId: req.user!.sub, product: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      ok(items.map((i) => ({ productId: i.productId, addedAt: i.createdAt.toISOString() }))),
    );
  });

  // Summaries for the wishlist page, newest first (archived products drop out).
  router.get("/wishlist/products", async (req, res) => {
    const items = await prisma.wishlistItem.findMany({
      where: { userId: req.user!.sub },
      orderBy: [{ createdAt: "desc" }, { productId: "asc" }],
      take: MAX_WISHLIST_PRODUCTS,
      select: { productId: true },
    });
    res.json(
      ok(
        await productSummariesByIds(
          prisma,
          items.map((i) => i.productId),
        ),
      ),
    );
  });

  router.post("/wishlist", async (req, res) => {
    const { productId } = WishlistInput.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: productId, status: "ACTIVE" } });
    if (!product) throw new AppError("NOT_FOUND", "Product not found.");
    const item = await prisma.wishlistItem.upsert({
      where: { userId_productId: { userId: req.user!.sub, productId } },
      create: { userId: req.user!.sub, productId },
      update: {},
    });
    res.status(201).json(ok({ productId: item.productId, addedAt: item.createdAt.toISOString() }));
  });

  router.delete("/wishlist/:productId", async (req, res) => {
    await prisma.wishlistItem.deleteMany({
      where: { userId: req.user!.sub, productId: req.params.productId },
    });
    res.json(ok({ deleted: true }));
  });

  return router;
}
